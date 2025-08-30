import mariadb from "mariadb";
const pool = mariadb.createPool({
  host: "localhost",
  user: "root",
  password: "bun",
  database: "mysql",
  port: 55034,
  connectionLimit: 10,
  acquireTimeout: 600000,
});

async function executeQuery() {
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query("SELECT * FROM users_bun_bench LIMIT 100");
  } finally {
    if (conn) conn.release(); //release to pool
  }
}

console.time("mariadb");
let promises = [];
for (let i = 0; i < 1_000_000; i++) {
  promises.push(executeQuery());
}
await Promise.all(promises);
console.timeEnd("mariadb");
await pool.end();
