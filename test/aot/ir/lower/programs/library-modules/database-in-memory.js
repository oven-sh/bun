// RUN: lower
// OPTIONS: builtin-modules

// bun:sqlite, imported by name: tables, prepared statements with every kind of parameter, all, get, values, run and iterate, transactions that commit and roll back, a class for the rows, blobs, errors with their codes, and serialize.
import { Database, constants, SQLiteError } from "bun:sqlite";

const db = new Database(":memory:");
db.run("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, age INTEGER, data BLOB)");
const insert = db.prepare("INSERT INTO people (name, age, data) VALUES ($name, $age, $data)");
console.log(JSON.stringify(insert.run({ $name: "Ada", $age: 36, $data: new Uint8Array([1, 2]) })), JSON.stringify(insert.run({ $name: "Bo", $age: null, $data: null })));
db.query("INSERT INTO people (name, age) VALUES (?, ?)").run("Cy", 20);
db.query("INSERT INTO people (name, age) VALUES (?1, ?2)").run("Di", 50);
console.log(JSON.stringify(db.query("SELECT id, name, age FROM people ORDER BY id").all()));
console.log(JSON.stringify(db.query("SELECT name FROM people WHERE age > ?").get(40)), db.query("SELECT name FROM people WHERE age > ?").get(99), JSON.stringify(db.query("SELECT name, age FROM people WHERE age IS NOT NULL ORDER BY age").values()));
console.log([...db.query("SELECT name FROM people ORDER BY name DESC").iterate()].map(row => row.name).join(), db.query("SELECT data FROM people WHERE id = 1").get().data.join(), db.query("SELECT count(*) AS n FROM people").get().n);
class Person { get shout() { return this.name.toUpperCase(); } }
console.log(db.query("SELECT name FROM people WHERE id = 1").as(Person).get().shout, db.query("SELECT 1 AS a, 'x' AS b, 1.5 AS c, NULL AS d").get(), db.query("SELECT name FROM people").columnNames.join(), db.query("SELECT ?").paramsCount);
const addBoth = db.transaction(names => { for (const name of names) db.run("INSERT INTO people (name) VALUES (?)", [name]); return names.length; });
console.log(addBoth(["Ed", "Fi"]), db.query("SELECT count(*) AS n FROM people").get().n);
try {
  addBoth(["Gu", "Ada"]);
} catch (error) {
  console.log(error instanceof SQLiteError, error.code, error.errno, error.message);
}
console.log(db.query("SELECT count(*) AS n FROM people").get().n, db.inTransaction);
try {
  db.query("SELECT * FROM nowhere");
} catch (error) {
  console.log(error.name, error.message);
}
const copy = Database.deserialize(db.serialize());
console.log(copy.query("SELECT count(*) AS n FROM people").get().n, typeof constants.SQLITE_OPEN_READONLY, db.filename);
copy.close();
db.close();
try {
  db.query("SELECT 1").get();
} catch (error) {
  console.log(error instanceof Error);
}

// GENERATED: Person shout
// CHECK-LABEL: function {{*}}name="Person"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shout"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_2]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="name"
// CHECK-NEXT: v3 = PropGet v2 key="toUpperCase"
// CHECK-NEXT: v4 = Call v3, v2 calleeKey="toUpperCase" calleeName="this.name.toUpperCase"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
