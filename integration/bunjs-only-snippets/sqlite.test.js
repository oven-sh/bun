import { expect, it } from "bun:test";
import { Database, constants } from "bun:sqlite";

var encode = (text) => Buffer.from(text);

it("Database.open", () => {
  // in a folder which doesn't exist
  try {
    Database.open(
      "/this/database/does/not/exist.sqlite",
      constants.SQLITE_OPEN_READWRITE
    );
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // in a file which doesn't exist
  try {
    Database.open(
      `/tmp/database-${Math.random()}.sqlite`,
      constants.SQLITE_OPEN_READWRITE
    );
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // in a file which doesn't exist
  try {
    Database.open(`/tmp/database-${Math.random()}.sqlite`, { readonly: true });
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // in a file which doesn't exist
  try {
    Database.open(`/tmp/database-${Math.random()}.sqlite`, { readwrite: true });
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    expect(error.message).toBe("unable to open database file");
  }

  // create works
  {
    var db = Database.open(`/tmp/database-${Math.random()}.sqlite`, {
      create: true,
    });
    db.close();
  }

  // this should not throw
  // it creates an in-memory db
  new Database().close();
});

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

it("typechecks", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec('INSERT INTO test (name) VALUES ("Hello")');
  db.exec('INSERT INTO test (name) VALUES ("World")');

  const q = db.prepare("SELECT * FROM test WHERE (name = ?)");

  var expectfail = (val) => {
    try {
      q.run([val]);
      throw new Error("Expected error");
    } catch (e) {
      expect(e.message !== "Expected error").toBe(true);
      expect(e.name).toBe("TypeError");
    }

    try {
      q.all([val]);
      throw new Error("Expected error");
    } catch (e) {
      expect(e.message !== "Expected error").toBe(true);
      expect(e.name).toBe("TypeError");
    }

    try {
      q.get([val]);
      throw new Error("Expected error");
    } catch (e) {
      expect(e.message !== "Expected error").toBe(true);
      expect(e.name).toBe("TypeError");
    }
  };

  expectfail(Symbol("oh hai"));
  expectfail(new Date());
  expectfail(class Foo {});
  expectfail(() => class Foo {});
  expectfail(new RangeError("what"));
  expectfail(new Map());
  expectfail(new Map([["foo", "bar"]]));
  expectfail(new Set());
  expectfail(new Set([1, 2, 3]));
});

it("db.query supports TypedArray", () => {
  const db = Database.open(":memory:");

  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, blobby BLOB)");

  const stmt = db.prepare("INSERT INTO test (blobby) VALUES (?)");
  stmt.run([encode("Hello World")]);
  stmt.finalize();

  const stmt2 = db.prepare("SELECT * FROM test");
  expect(JSON.stringify(stmt2.get())).toBe(
    JSON.stringify({
      id: 1,
      blobby: encode("Hello World"),
    })
  );

  const stmt3 = db.prepare("SELECT * FROM test WHERE (blobby = ?)");

  expect(JSON.stringify(stmt3.get([encode("Hello World")]))).toBe(
    JSON.stringify({
      id: 1,
      blobby: encode("Hello World"),
    })
  );

  expect(
    JSON.stringify(
      db
        .query("SELECT * FROM test WHERE (blobby = ?)")
        .get([encode("Hello World")])
    )
  ).toBe(
    JSON.stringify({
      id: 1,
      blobby: encode("Hello World"),
    })
  );

  expect(stmt3.get([encode("Hello World NOT")])).toBe(null);
});

it("supports serialize/deserialize", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec('INSERT INTO test (name) VALUES ("Hello")');
  db.exec('INSERT INTO test (name) VALUES ("World")');

  const input = db.serialize();
  const db2 = new Database(input);

  const stmt = db2.prepare("SELECT * FROM test");
  expect(JSON.stringify(stmt.get())).toBe(
    JSON.stringify({
      id: 1,
      name: "Hello",
    })
  );

  expect(JSON.stringify(stmt.all())).toBe(
    JSON.stringify([
      {
        id: 1,
        name: "Hello",
      },
      {
        id: 2,
        name: "World",
      },
    ])
  );
  db2.exec("insert into test (name) values ('foo')");
  expect(JSON.stringify(stmt.all())).toBe(
    JSON.stringify([
      {
        id: 1,
        name: "Hello",
      },
      {
        id: 2,
        name: "World",
      },
      {
        id: 3,
        name: "foo",
      },
    ])
  );

  const db3 = new Database(input, { readonly: true });
  try {
    db3.exec("insert into test (name) values ('foo')");
    throw new Error("Expected error");
  } catch (e) {
    expect(e.message).toBe("attempt to write a readonly database");
  }
});

it("db.query()", () => {
  const db = Database.open(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");

  expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(0);

  var q = db.query("SELECT * FROM test WHERE name = ?");
  expect(q.get("Hello") === null).toBe(true);

  db.exec('INSERT INTO test (name) VALUES ("Hello")');
  db.exec('INSERT INTO test (name) VALUES ("World")');

  var rows = db.query("SELECT * FROM test WHERE name = ?").all(["Hello"]);

  expect(JSON.stringify(rows)).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));

  rows = db.query("SELECT * FROM test WHERE name = ?").all(["World"]);

  // if this fails, it means the query caching failed to update
  expect(JSON.stringify(rows)).toBe(JSON.stringify([{ id: 2, name: "World" }]));

  rows = db.query("SELECT * FROM test WHERE name = ?").all(["Hello"]);
  expect(JSON.stringify(rows)).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));

  // check that the query is cached
  expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(1);

  db.clearQueryCache();

  // check clearing the cache decremented the counter
  expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(0);

  q.finalize();
  try {
    // check clearing the cache decremented the counter

    q.all(["Hello"]);
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e.message !== "Should have thrown").toBe(true);
  }

  // check that invalid queries are not cached
  // and invalid queries throw
  try {
    db.query("SELECT * FROM BACON", ["Hello"]).all();
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e.message !== "Should have thrown").toBe(true);
    expect(db[Symbol.for("Bun.Database.cache.count")]).toBe(0);
  }

  // check that it supports multiple arguments
  expect(
    JSON.stringify(
      db
        .query("SELECT * FROM test where (name = ? OR name = ?)")
        .all(["Hello", "Fooooo"])
    )
  ).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));
  expect(
    JSON.stringify(
      db
        .query("SELECT * FROM test where (name = ? OR name = ?)")
        .all("Hello", "Fooooo")
    )
  ).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));

  // throws if insufficeint arguments
  try {
    db.query("SELECT * FROM test where (name = ? OR name = ?)").all("Hello");
  } catch (e) {
    expect(e.message).toBe("Expected 2 values, got 1");
  }

  // named parameters
  expect(
    JSON.stringify(
      db
        .query("SELECT * FROM test where (name = $hello OR name = $goodbye)")
        .all({
          $hello: "Hello",
          $goodbye: "Fooooo",
        })
    )
  ).toBe(JSON.stringify([{ id: 1, name: "Hello" }]));

  db.close();

  // Check that a closed database doesn't crash
  // and does throw an error when trying to run a query
  try {
    db.query("SELECT * FROM test WHERE name = ?").all(["Hello"]);
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e.message !== "Should have thrown").toBe(true);
  }

  // check that we can call close multiple times
  // it should not throw so that your code doesn't break
  db.close();
  db.close();
  db.close();
});

it("db.transaction()", () => {
  const db = Database.open(":memory:");

  db.exec(
    "CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)"
  );

  const insert = db.prepare(
    "INSERT INTO cats (name, age) VALUES (@name, @age)"
  );

  expect(db.inTransaction).toBe(false);
  const insertMany = db.transaction((cats) => {
    expect(db.inTransaction).toBe(true);
    try {
      for (const cat of cats) insert.run(cat);
    } catch (exception) {
      throw exception;
    }
  });

  try {
    insertMany([
      { "@name": "Joey", "@age": 2 },
      { "@name": "Sally", "@age": 4 },
      { "@name": "Junior", "@age": 1 },
      { "@name": "Sally", "@age": 4 },
    ]);
    throw new Error("Should have thrown");
  } catch (exception) {
    expect(exception.message).toBe("constraint failed");
  }

  expect(db.inTransaction).toBe(false);
  expect(db.query("SELECT * FROM cats").all().length).toBe(0);

  expect(db.inTransaction).toBe(false);
  insertMany([
    { "@name": "Joey", "@age": 2 },
    { "@name": "Sally", "@age": 4 },
    { "@name": "Junior", "@age": 1 },
  ]);
  expect(db.inTransaction).toBe(false);
  expect(db.query("SELECT * FROM cats").all().length).toBe(3);
  expect(db.inTransaction).toBe(false);
});
