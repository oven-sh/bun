const log = [];
let sink = 0;

function later(value) {
  return new Promise(resolve => Promise.resolve().then(() => resolve(value)));
}
function failLater(message) {
  return new Promise((resolve, reject) => Promise.resolve().then(() => reject(new Error(message))));
}
const thenable = value => ({
  then(resolve) {
    resolve(value);
  },
});

async function awaitsOnce(value) {
  const got = await value;
  return [got];
}
async function awaitsTwice(first, second) {
  const a = await first;
  const b = await second;
  return [a, b];
}
async function awaitsInLoop(count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += await later(i);
  return total;
}
async function catches(value) {
  try {
    return await value;
  } catch (error) {
    return "caught " + error.message;
  } finally {
    sink++;
  }
}
async function keepsLocals(a, b, c, d, e) {
  const before = [a, b, c, d, e].join();
  const x = await later(a + b);
  const y = await c;
  const z = await thenable(d + e);
  return before + "|" + [a, b, c, d, e, x, y, z].join();
}
const arrow = async value => (await value) + 1;
const holder = {
  base: 10,
  async method(value) {
    return this.base + (await value);
  },
};

function level1(f, x) { const p = f(x); sink++; return p; }
function level2(f, x) { const p = level1(f, x); sink++; return p; }
function level3(f, x) { const p = level2(f, x); sink++; return p; }
function level4(f, x) { const p = level3(f, x); sink++; return p; }
function level5(f, x) { const p = level4(f, x); sink++; return p; }
function level6(f, x) { const p = level5(f, x); sink++; return p; }
function recurse(depth, f, x) {
  if (!depth) return f(x);
  const p = recurse(depth - 1, f, x);
  sink++;
  return p;
}
async function asyncRecursion(depth) {
  if (!depth) return await later(0);
  return 1 + (await asyncRecursion(depth - 1));
}

const show = value => JSON.stringify(value);

async function main() {
  const values = [1, "text", null, undefined, Promise.resolve(2), later(3), thenable(4), { plain: true }];
  for (const value of values) log.push("once " + show(await awaitsOnce(value)));
  for (const value of [5, Promise.resolve(6), later(7), thenable(8)]) {
    log.push("at depth " + show(await level6(awaitsOnce, value)) + " " + show(await recurse(40, awaitsOnce, value)) + " " + show(await recurse(200, awaitsOnce, value)));
  }
  log.push("twice " + show(await awaitsTwice(later(1), later(2))) + show(await awaitsTwice(1, later(2))) + show(await awaitsTwice(later(1), 2)) + show(await awaitsTwice(1, 2)));
  log.push("loop " + (await awaitsInLoop(0)) + " " + (await awaitsInLoop(1)) + " " + (await awaitsInLoop(50)));
  log.push("catches " + [await catches(1), await catches(failLater("late")), await catches(Promise.reject(new Error("now"))), await level6(catches, failLater("deep"))].join(" | "));
  log.push("locals " + (await keepsLocals(1, 2, 3, 4, 5)) + " " + (await keepsLocals("a", "b", later("c"), "d", "e")));
  log.push("arrow and method " + (await arrow(1)) + " " + (await arrow(later(2))) + " " + (await holder.method(1)) + " " + (await holder.method(later(2))) + " " + (await level6(arrow, later(3))));
  log.push("async recursion " + (await asyncRecursion(0)) + " " + (await asyncRecursion(5)) + " " + (await asyncRecursion(100)));
  const order = [];
  await Promise.all([
    (async () => { order.push("a1"); await null; order.push("a2"); await later(); order.push("a3"); })(),
    (async () => { order.push("b1"); await later(); order.push("b2"); await null; order.push("b3"); })(),
    level6(async () => { order.push("c1"); await null; order.push("c2"); }),
  ]);
  log.push("order " + order.join());
  let uncaught;
  try {
    await level6(awaitsOnce, failLater("passes through"));
  } catch (error) {
    uncaught = error.message;
  }
  log.push("rejection " + uncaught);
  let total = 0;
  for (let i = 0; i < 20000; i++) total += (await level6(awaitsOnce, i & 7))[0];
  log.push("many " + total + " sink " + sink);
  console.log(log.join("\n"));
}
main();
