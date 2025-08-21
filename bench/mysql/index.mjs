const isBun = typeof globalThis?.Bun !== "undefined";

// For now, both Bun and Node.js use mysql2 until Bun gets native MySQL
const mysql = await import("mysql2/promise");
const connection = await mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "test"
});
const sql = connection;

// Create the table if it doesn't exist
await sql.execute(`
    CREATE TABLE IF NOT EXISTS users_bun_bench (
      id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      dob DATE NOT NULL
    )
  `);

// Check if users already exist
const [existingUsers] = await sql.execute("SELECT COUNT(*) as count FROM users_bun_bench");

if (existingUsers[0].count < 100) {
  // Generate 100 users if none exist  
  for (let i = 0; i < 100; i++) {
    const firstName = `FirstName${i}`;
    const lastName = `LastName${i}`;
    const email = `user${i}@example.com`;
    const year = 1970 + (i % 30);
    const month = 1 + (i % 12); 
    const day = 1 + (i % 28);
    const dob = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    
    await sql.execute(
      "INSERT INTO users_bun_bench (first_name, last_name, email, dob) VALUES (?, ?, ?, ?)",
      [firstName, lastName, email, dob]
    );
  }
}

// Benchmark: Run 100,000 SELECT queries
const start = performance.now();
const totalQueries = 100_000;
const batchSize = 100;

for (let batchStart = 0; batchStart < totalQueries; batchStart += batchSize) {
  const promises = [];
  
  for (let j = 0; j < batchSize; j++) {
    promises.push(sql.execute("SELECT * FROM users_bun_bench LIMIT 100"));
  }
  
  // Wait for this batch to complete
  await Promise.all(promises);
}

const elapsed = performance.now() - start;
const runtime = isBun ? "Bun" : (typeof Deno !== "undefined" ? "Deno" : "Node.js");
console.log(`${runtime} (MySQL2): ${elapsed.toFixed(2)}ms`);

await sql.end();