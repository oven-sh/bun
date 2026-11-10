import mysql from "mysql2/promise";

console.log(
  mysql.format(
    "select * from ?? where id = ? and name in (?) and at = ?",
    ["users", 1, ["a", "b'c"], new Date(0)],
    false,
    "Z",
  ),
);
console.log(
  mysql.escape({ a: 1, b: "x" }),
  mysql.escapeId("a.b`c"),
  mysql.escape(null),
  mysql.escape(Buffer.from([1, 255])),
  mysql.raw("now()").toSqlString(),
);
try {
  await mysql.createConnection({ host: "127.0.0.1", port: 1, user: "u", connectTimeout: 2000 });
} catch (error) {
  console.log((error as NodeJS.ErrnoException).code, (error as { fatal: boolean }).fatal);
}
const pool = mysql.createPool({ host: "127.0.0.1", port: 1, connectionLimit: 2 });
console.log(typeof pool.query, typeof pool.getConnection);
await pool.end();
