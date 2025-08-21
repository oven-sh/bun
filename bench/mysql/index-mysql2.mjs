import mysql from "mysql2/promise";

// Create connection
const connection = await mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "test"
});

// Create the table if it doesn't exist
await connection.execute(`
    CREATE TABLE IF NOT EXISTS users_bun_bench (
      id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      dob DATE NOT NULL
    )
  `);

// Check if users already exist
const [existingUsers] = await connection.execute("SELECT COUNT(*) as count FROM users_bun_bench");

if (existingUsers[0].count < 100) {
  // Generate 100 users if none exist
  const users = Array.from({ length: 100 }, (_, i) => [
    `FirstName${i}`,
    `LastName${i}`,
    `user${i}@example.com`,
    new Date(1970 + Math.floor(Math.random() * 30), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28))
      .toISOString()
      .split("T")[0],
  ]);

  // Insert all users
  const insertQuery = "INSERT INTO users_bun_bench (first_name, last_name, email, dob) VALUES ?";
  await connection.execute(insertQuery, [users]);
}

const runtime = typeof globalThis?.Bun !== "undefined" ? "Bun" : 
                typeof globalThis?.Deno !== "undefined" ? "Deno" : "Node.js";
const type = `mysql2 (${runtime})`;
console.time(type);
let promises = [];
for (let i = 0; i < 100_000; i++) {
  promises.push(connection.execute("SELECT * FROM users_bun_bench LIMIT 100"));
  if (i % 100 === 0 && promises.length > 1) {
    await Promise.all(promises);
    promises.length = 0;
  }
}
await Promise.all(promises);
console.timeEnd(type);

await connection.end();