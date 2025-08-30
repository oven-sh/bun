import { createPool } from "mysql2/promise";
const pool = createPool({
  host: "localhost",
  user: "root",
  password: "bun",
  database: "mysql",
  port: 55034,
  waitForConnections: true,
  connectionLimit: 10,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Create the table if it doesn't exist
await pool.execute(`CREATE TABLE IF NOT EXISTS users_bun_bench (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name  VARCHAR(255) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    dob        DATE NOT NULL
)`);

// Check if users already exist
const existingUsers = await pool.execute(`SELECT COUNT(*) as count FROM users_bun_bench`);

if (+(existingUsers?.[0]?.count ?? existingUsers?.count) < 100) {
  // Generate 100 users if none exist
  const users = Array.from({ length: 100 }, (_, i) => ({
    first_name: `FirstName${i}`,
    last_name: `LastName${i}`,
    email: `user${i}@example.com`,
    dob: new Date(1970 + Math.floor(Math.random() * 30), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28))
      .toISOString()
      .split("T")[0],
  }));

  for (let user of users) {
    await pool.execute(
      `INSERT INTO users_bun_bench (first_name, last_name, email, dob) VALUES (?, ?, ?, ?)`,
      user.first_name,
      user.last_name,
      user.email,
      user.dbo,
    );
  }
}

console.time("mysql2");
let promises = [];
for (let i = 0; i < 1_000_000; i++) {
  promises.push(pool.execute(`SELECT * FROM users_bun_bench LIMIT 100`));
}
await Promise.all(promises);
console.timeEnd("mysql2");
await pool.end();
