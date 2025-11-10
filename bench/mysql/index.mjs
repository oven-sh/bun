const sql = new Bun.SQL("mysql://root:bun@localhost:55034");

// Create the table if it doesn't exist
await sql`CREATE TABLE IF NOT EXISTS users_bun_bench (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name  VARCHAR(255) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    dob        DATE NOT NULL
)`;

// Check if users already exist
const existingUsers = await sql`SELECT COUNT(*) as count FROM users_bun_bench`;

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

  // Insert all users
  await sql`INSERT INTO users_bun_bench ${sql(users)}`;
}

console.time("Bun.sql");
let promises = [];
for (let i = 0; i < 1_000_000; i++) {
  promises.push(sql`SELECT * FROM users_bun_bench LIMIT 100`);
}
await Promise.all(promises);
console.timeEnd("Bun.sql");
