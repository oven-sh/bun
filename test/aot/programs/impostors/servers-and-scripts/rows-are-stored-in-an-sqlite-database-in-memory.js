import { Database } from "bun:sqlite";

const db = new Database(":memory:");
db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, age INTEGER, score REAL, photo BLOB)");
const insert = db.prepare("INSERT INTO users (name, age, score, photo) VALUES ($name, $age, $score, $photo)");
console.log(insert.run({ $name: "Ada", $age: 36, $score: 9.5, $photo: new Uint8Array([1, 2]) }));
console.log(insert.run({ $name: "Bob", $age: null, $score: 7, $photo: null }).lastInsertRowid);
const many = db.transaction(rows => {
  for (const row of rows) db.run("INSERT INTO users (name, age) VALUES (?, ?)", [row.name, row.age]);
  return rows.length;
});
console.log(many([{ name: "Cy", age: 20 }, { name: "Di", age: 41 }]));
try {
  many([{ name: "Ed", age: 1 }, { name: "Ada", age: 2 }]);
} catch (error) {
  console.log(error.name, error.code, error.message);
}
console.log(db.query("SELECT count(*) AS n FROM users").get(), db.query("SELECT name FROM users WHERE age > ? ORDER BY name").all(30), db.query("SELECT * FROM users WHERE id = ?").get(1));
console.log(db.query("SELECT name, age FROM users ORDER BY id").values(), db.query("SELECT * FROM users WHERE id = 99").get(), db.query("SELECT * FROM users WHERE id = 99").all());
const byName = db.query("SELECT id, score FROM users WHERE name = $name");
console.log(byName.get({ $name: "Bob" }), byName.columnNames, byName.paramsCount, String(byName).includes("SELECT"));
for (const row of db.query("SELECT id FROM users WHERE id < 3").iterate()) console.log("row", row.id);
class User {
  get label() {
    return this.name + "#" + this.id;
  }
}
console.log(db.query("SELECT id, name FROM users WHERE id = 2").as(User).get().label, db.query("SELECT 9007199254740993 AS big, 1.0 AS floating, 'x' AS word, NULL AS missing, x'00ff' AS bytes").get());
console.log(db.run("UPDATE users SET age = age + 1 WHERE age IS NOT NULL").changes, db.run("DELETE FROM users WHERE name = ?", "Cy").changes, db.inTransaction, db.filename);
try {
  db.query("SELECT * FROM nowhere");
} catch (error) {
  console.log(error.name, error.message);
}
const saved = db.serialize();
console.log(saved.length > 0, Database.deserialize(saved).query("SELECT count(*) AS n FROM users").get().n);
insert.finalize();
db.close();
try {
  db.query("SELECT 1").get();
} catch (error) {
  console.log("closed:", error.name);
}
