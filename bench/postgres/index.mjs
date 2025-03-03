const isBun = typeof globalThis?.Bun?.sql !== "undefined";
import postgres from "postgres";
const sql = isBun ? Bun.sql : postgres;

// Create the table if it doesn't exist
await sql`
    CREATE TABLE IF NOT EXISTS "users_bun_bench" (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL, 
      email TEXT NOT NULL UNIQUE,
      dob TEXT NOT NULL
    )
  `;

// Check if users already exist
const existingUsers = await sql`SELECT COUNT(*) as count FROM "users_bun_bench"`;

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
  await sql`
      INSERT INTO users_bun_bench (first_name, last_name, email, dob) ${sql(users)}
    `;
}

const type = isBun ? "Bun.sql" : "postgres";
console.time(type);
let promises = [];
for (let i = 0; i < 100_000; i++) {
  promises.push(sql`SELECT * FROM "users_bun_bench" LIMIT 100`);
  if (i % 100 === 0 && promises.length > 1) {
    await Promise.all(promises);
    promises.length = 0;
  }
}
await Promise.all(promises);
console.timeEnd(type);
