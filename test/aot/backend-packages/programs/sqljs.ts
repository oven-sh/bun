/// <reference path="./lib_ambient.d.ts" />
import initSqlJs from "sql.js";
import { timed } from "./lib_http.ts";

const SQL = await timed("load", () => initSqlJs());
const db = new SQL.Database();
db.run("create table person (id integer primary key, name text, age integer)");
await timed("20,000 inserts", () => {
  db.run("begin");
  const insert = db.prepare("insert into person (name, age) values (?, ?)");
  for (let i = 0; i < 20000; i++) insert.run(["n" + i, i % 90]);
  insert.free();
  db.run("commit");
});
console.log(JSON.stringify(await timed("a grouped query", () => db.exec("select age % 3 as k, count(*), sum(age) from person group by k order by k"))));
db.close();
console.log("DONE");
