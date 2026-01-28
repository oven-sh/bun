const isBun = typeof globalThis?.Bun?.sql !== "undefined";
let conn;
let sql;
import * as mariadb from "mariadb";
import * as mysql2 from "mysql2/promise";
let useMYSQL2 = false;
if (process.argv.includes("--mysql2")) {
  useMYSQL2 = true;
}
if (isBun) {
  sql = new Bun.SQL({
    adapter: "mysql",
    database: "test",
    username: "root",
  });
} else {
  const pool = (useMYSQL2 ? mysql2 : mariadb).createPool({
    // Add your MariaDB connection details here
    user: "root",
    database: "test",
  });
  conn = await pool.getConnection();
}

if (isBun) {
  // Initialize the benchmark table (equivalent to initFct)
  await sql`DROP TABLE IF EXISTS test100`;
  await sql`CREATE TABLE test100 (i1 int,i2 int,i3 int,i4 int,i5 int,i6 int,i7 int,i8 int,i9 int,i10 int,i11 int,i12 int,i13 int,i14 int,i15 int,i16 int,i17 int,i18 int,i19 int,i20 int,i21 int,i22 int,i23 int,i24 int,i25 int,i26 int,i27 int,i28 int,i29 int,i30 int,i31 int,i32 int,i33 int,i34 int,i35 int,i36 int,i37 int,i38 int,i39 int,i40 int,i41 int,i42 int,i43 int,i44 int,i45 int,i46 int,i47 int,i48 int,i49 int,i50 int,i51 int,i52 int,i53 int,i54 int,i55 int,i56 int,i57 int,i58 int,i59 int,i60 int,i61 int,i62 int,i63 int,i64 int,i65 int,i66 int,i67 int,i68 int,i69 int,i70 int,i71 int,i72 int,i73 int,i74 int,i75 int,i76 int,i77 int,i78 int,i79 int,i80 int,i81 int,i82 int,i83 int,i84 int,i85 int,i86 int,i87 int,i88 int,i89 int,i90 int,i91 int,i92 int,i93 int,i94 int,i95 int,i96 int,i97 int,i98 int,i99 int,i100 int)`;
  await sql`INSERT INTO test100 value (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100)`;
} else {
  // Initialize the benchmark table (equivalent to initFct)
  await conn.query("DROP TABLE IF EXISTS test100");
  await conn.query(
    "CREATE TABLE test100 (i1 int,i2 int,i3 int,i4 int,i5 int,i6 int,i7 int,i8 int,i9 int,i10 int,i11 int,i12 int,i13 int,i14 int,i15 int,i16 int,i17 int,i18 int,i19 int,i20 int,i21 int,i22 int,i23 int,i24 int,i25 int,i26 int,i27 int,i28 int,i29 int,i30 int,i31 int,i32 int,i33 int,i34 int,i35 int,i36 int,i37 int,i38 int,i39 int,i40 int,i41 int,i42 int,i43 int,i44 int,i45 int,i46 int,i47 int,i48 int,i49 int,i50 int,i51 int,i52 int,i53 int,i54 int,i55 int,i56 int,i57 int,i58 int,i59 int,i60 int,i61 int,i62 int,i63 int,i64 int,i65 int,i66 int,i67 int,i68 int,i69 int,i70 int,i71 int,i72 int,i73 int,i74 int,i75 int,i76 int,i77 int,i78 int,i79 int,i80 int,i81 int,i82 int,i83 int,i84 int,i85 int,i86 int,i87 int,i88 int,i89 int,i90 int,i91 int,i92 int,i93 int,i94 int,i95 int,i96 int,i97 int,i98 int,i99 int,i100 int)",
  );
  await conn.query(
    "INSERT INTO test100 value (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100)",
  );
}
// Run the benchmark (equivalent to benchFct)
const type = isBun ? "Bun.SQL" : useMYSQL2 ? "mysql2" : "mariadb";
console.time(type);
let promises = [];

for (let i = 0; i < 100_000; i++) {
  if (isBun) {
    promises.push(sql`select * FROM test100`);
  } else {
    promises.push(conn.query("select * FROM test100"));
  }
}
await Promise.all(promises);
console.timeEnd(type);

// Clean up connection
if (!isBun && conn.release) {
  conn.release();
}
