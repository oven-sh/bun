import { expect, it } from "bun:test";
import { Database } from "bun:sqlite";

var encode = (text) => new TextEncoder().encode(text);

it("creates", () => {
  const db = Database.open(":memory:");
  db.exec(
    "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER, created TEXT, deci FLOAT, blobby BLOB)"
  );
  const stmt = db.prepare(
    "INSERT INTO test (name, value, deci, created, blobby) VALUES (?, ?, ?, ?, ?)"
  );

  stmt.run([
    "foo",
    1,
    Math.fround(1.111),
    new Date(1995, 12, 19).toISOString(),
    encode("Hello World"),
  ]);
  stmt.run([
    "bar",
    2,
    Math.fround(2.222),
    new Date(1995, 12, 19).toISOString(),
    encode("Hello World"),
  ]);
  stmt.run([
    "baz",
    3,
    Math.fround(3.333),
    new Date(1995, 12, 19).toISOString(),
    encode("Hello World"),
  ]);
  stmt.finalize();

  const stmt2 = db.prepare("SELECT * FROM test");
  expect(JSON.stringify(stmt2.get())).toBe(
    JSON.stringify({
      id: 1,
      name: "foo",
      value: 1,
      created: new Date(1995, 12, 19).toISOString(),
      deci: Math.fround(1.111),
      blobby: encode("Hello World"),
    })
  );

  expect(JSON.stringify(stmt2.all())).toBe(
    JSON.stringify([
      {
        id: 1,
        name: "foo",
        value: 1,
        created: new Date(1995, 12, 19).toISOString(),
        deci: Math.fround(1.111),
        blobby: encode("Hello World"),
      },
      {
        id: 2,
        name: "bar",
        value: 2,
        created: new Date(1995, 12, 19).toISOString(),
        deci: Math.fround(2.222),
        blobby: encode("Hello World"),
      },
      {
        id: 3,
        name: "baz",
        value: 3,
        created: new Date(1995, 12, 19).toISOString(),
        deci: Math.fround(3.333),
        blobby: encode("Hello World"),
      },
    ])
  );
  expect(stmt2.run()).toBe(undefined);

  // not necessary to run but it's a good practice
  stmt2.finalize();
});

it("works", () => {
  const db = Database.open("/tmp/northwind.sqlite");
  console.log(db.prepare(`SELECT * FROM "Order"`).get());
});

it("supports WHERE clauses", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

  var q = db.query("SELECT * FROM test WHERE name = ?", ["Hello"]);
  expect(q.get() === null).toBe(true);

  db.exec('INSERT INTO test (name) VALUES ("Hello")');
  db.exec('INSERT INTO test (name) VALUES ("World")');

  var rows = db.query("SELECT * FROM test WHERE name = ?", ["Hello"]).all();

  expect(JSON.stringify(rows)).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));

  rows = db.query("SELECT * FROM test WHERE name = ?", "World").all();

  // if this fails, it means the query caching failed to update
  expect(JSON.stringify(rows)).toBe(JSON.stringify([{ id: 2, name: "World" }]));

  rows = db.query("SELECT * FROM test WHERE name = ?", "Hello").all();

  // check that the query is cached
  expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(1);
  db.clearQueryCache();

  // check clearing the cache decremented the counter
  expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(0);

  try {
    // check clearing the cache decremented the counter
    q.all(["Hello"]);
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e.message !== "Should have thrown").toBe(true);
  }
  db.close();

  try {
    db.query("SELECT * FROM test WHERE name = ?", ["Hello"]).all();
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e.message !== "Should have thrown").toBe(true);
  }
});
