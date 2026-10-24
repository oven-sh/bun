// Every initializer here depends on when it runs. A lazy one would answer differently.
let counter = 0;
function next() { return ++counter; }
const first = { n: next() };
const second = { n: next() };
const startedAt = { t: Date.now() };
const date = new Date();
const random = [Math.random()];
const clock = { p: performance.now() };
const hr = { h: process.hrtime.bigint() };
const failure = new Error("made at the start");
const where = { stack: new Error("x").stack };
const env = { home: process.env.LAZY_ATTACK };
const cwd = { dir: process.cwd() };
const argv = [...process.argv];
const memory = { rss: process.memoryUsage().rss > 0 };
let mutable = 1;
const snapshot = { m: mutable };
const table = { a: 1 };
const copy = { ...table };
const keys = Object.keys(table);
const picked = { a: table.a };
const listed = [table.a, table.a + 1];
const text = { s: JSON.stringify(table) };

function deep(n: number): unknown { return n ? deep(n - 1) : [failure.stack!.split("\n").length, where.stack!.split("\n").length]; }

function main() {
  mutable = 2;
  table.a = 99;
  (table as any).b = 5;
  process.env.LAZY_ATTACK = "changed";
  counter = 100;
  const later = Date.now();
  let spin = 0;
  while (Date.now() - later < 5) spin++;
  console.log(second.n, first.n);
  console.log(startedAt.t <= later, date.getTime() <= later, clock.p < performance.now() - 4, hr.h < process.hrtime.bigint());
  console.log(random[0] === random[0]);
  console.log(JSON.stringify(deep(20)));
  console.log(env.home, typeof cwd.dir, argv.length, memory.rss);
  console.log(snapshot.m, JSON.stringify(copy), keys.join(), picked.a, listed.join(), text.s);
}
main();
