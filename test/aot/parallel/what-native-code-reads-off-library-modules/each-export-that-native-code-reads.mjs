// Native code loads a module of the library and reads one export off it: each place where it does so, and what the program then holds.
import util from "node:util";
import timersPromises from "node:timers/promises";

for (const name of ["setTimeout", "setInterval", "setImmediate"]) {
  const custom = globalThis[name][util.promisify.custom];
  console.log(name, typeof custom, custom === timersPromises[name], util.promisify(globalThis[name]) === timersPromises[name]);
}
console.log("waited for", await util.promisify(setTimeout)(1, "the value"));

// A method that prints its own object is handed the printer of node:util.
const printsItself = {
  [util.inspect.custom](depth, options, inspect) {
    return "printed by itself; the printer is util.inspect: " + (inspect === util.inspect) + ", " + inspect({ a: [1, { b: 2 }] });
  },
};
console.log(printsItself);
console.log(Bun.inspect(printsItself));

console.log("Bun.sql", typeof Bun.sql, typeof Bun.sql.unsafe, typeof Bun.sql.begin, Bun.sql === Bun.sql);
console.log("Bun.SQL", typeof Bun.SQL, Bun.SQL.name, typeof Bun.SQL.PostgresError, typeof Bun.SQL.MySQLError);

// Nobody listens there: the adapters make their errors in native code, of the classes of the library.
for (const [adapter, url] of [["postgres", "postgres://nobody@127.0.0.1:1/nothing"], ["mysql", "mysql://nobody@127.0.0.1:1/nothing"]]) {
  const sql = new Bun.SQL(url, { max: 1, connectionTimeout: 2 });
  try {
    await sql`select 1`;
    console.log(adapter, "answered");
  } catch (error) {
    console.log(adapter, error.constructor.name, error instanceof Bun.SQL.SQLError, error instanceof Bun.SQL.PostgresError, error instanceof Bun.SQL.MySQLError, error instanceof Error, error.code);
  }
  await sql.close().catch(() => {});
}
