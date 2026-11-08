// Under: --aot-testing=CheckProofsAtRunTime: what is proven of a field that a descriptor fills, and of the descriptor's own fields, is asked again at run time
// A literal is filled at its birth up to the first member that is converted, and the rest is stored behind it: a descriptor that names a flag in front of its value has the value stored. It lies under the
// name as where the allocation lays it. What only looks like it stays out: a value on one arm, a name written twice, a spread, a descriptor that is used twice, read again, changed through another name or made in a loop.
function tryTo(deed) {
  try { return deed(); } catch (error) { return error.name; }
}
function plus(a, b) { return (a + b) | 0; }
function minus(a, b) { return (a - b) | 0; }
function times(a, b) { return Math.imul(a, b); }
function flagsOf(object, name) {
  const found = Object.getOwnPropertyDescriptor(object, name);
  return `${found.writable ? "w" : "-"}${found.enumerable ? "e" : "-"}${found.configurable ? "c" : "-"}`;
}

const tools = { other: 1 };
Object.defineProperty(tools, "join", { enumerable: true, value: plus });
Object.defineProperty(tools, "part", { enumerable: false, configurable: true, value: minus });
Object.defineProperty(tools, "grow", { writable: true, enumerable: true, configurable: true, value: times });
let sum = 0;
for (let i = 0; i < 1000; i++) sum = (sum + tools.join(i, 3) + tools.part(i, 5) + tools.grow(i, 7)) | 0;
console.log(sum, Object.keys(tools).join(), flagsOf(tools, "join"), flagsOf(tools, "part"), flagsOf(tools, "grow"), JSON.stringify(tools));
console.log(tryTo(() => { "use strict"; tools.join = minus; return "stored"; }), tools.join === plus, tools.join(8, 2));
console.log(tryTo(() => { tools.grow = plus; return "stored"; }), tools.grow === plus, tools.grow(8, 2));
console.log(tryTo(() => { Object.defineProperty(tools, "part", { enumerable: true, value: times }); return "laid"; }), tools.part(8, 2), flagsOf(tools, "part"));
console.log(tryTo(() => { Object.defineProperty(tools, "join", { enumerable: true, value: times }); return "laid"; }), tools.join(8, 2));
console.log(tryTo(() => { "use strict"; return delete tools.join; }), tryTo(() => delete tools.part), "part" in tools, "join" in tools);

function onOneArm(choose) {
  const holder = { other: 1 };
  const laid = { enumerable: true };
  if (choose) laid.value = plus;
  Object.defineProperty(holder, "run", laid);
  return typeof holder.run === "function" ? holder.run(4, 2) : String(holder.run);
}
console.log(onOneArm(true), onOneArm(false), onOneArm(process.argv.length > 99));

function writtenTwice() {
  const holder = { other: 1 };
  Object.defineProperty(holder, "run", { enumerable: true, value: plus, value: minus });
  return holder.run(4, 2);
}
function bySpread(more) {
  const holder = { other: 1 };
  Object.defineProperty(holder, "run", { enumerable: true, value: plus, ...more });
  return holder.run(4, 2);
}
console.log(writtenTwice(), bySpread({}), bySpread({ value: times }), bySpread(JSON.parse("{}")));

function usedTwice() {
  const first = { other: 1 }, second = { other: 2 };
  const laid = { enumerable: true, value: plus };
  Object.defineProperty(first, "run", laid);
  laid.value = minus;
  Object.defineProperty(second, "run", laid);
  return [first.run(4, 2), second.run(4, 2), laid.value === minus];
}
function readAgain() {
  const holder = { other: 1 };
  const laid = { enumerable: true, value: times };
  Object.defineProperty(holder, "run", laid);
  return [laid.value === times, laid.value(4, 2), holder.run === laid.value, Object.keys(laid).join()];
}
function handedOn(keep) {
  const holder = { other: 1 };
  const laid = { enumerable: true, value: times };
  keep.push(laid);
  Object.defineProperty(holder, "run", laid);
  return holder.run(4, 2) + keep[0].value(1, 1);
}
function changedThroughAnotherName(keep) {
  const holder = { other: 1 };
  const laid = { enumerable: true, value: times };
  keep.push(laid);
  keep[0].value = minus;
  Object.defineProperty(holder, "run", laid);
  let total = 0;
  for (let i = 0; i < 100; i++) total = (total + holder.run(i, 2)) | 0;
  return total;
}
console.log(usedTwice().join(), readAgain().join(), handedOn([]), changedThroughAnotherName([]));

function inLoop(list) {
  const made = [];
  for (const each of list) {
    const holder = { other: made.length };
    Object.defineProperty(holder, "run", { enumerable: true, value: each });
    made.push(holder);
  }
  let total = 0;
  for (let i = 0; i < 300; i++) total = (total + made[i % made.length].run(i, 2)) | 0;
  return total;
}
console.log(inLoop([plus, minus, times]), inLoop([plus]));

const kinds = { other: 1 };
Object.defineProperty(kinds, "count", { enumerable: true, value: 41 });
Object.defineProperty(kinds, "label", { enumerable: true, value: "text" });
Object.defineProperty(kinds, "inner", { enumerable: true, value: { deep: 2.5 } });
Object.defineProperty(kinds, "none", { enumerable: true, value: undefined });
Object.defineProperty(kinds, "bare", { enumerable: true });
console.log(kinds.count + 1, kinds.label.length, kinds.inner.deep * 2, kinds.none, kinds.bare, Object.keys(kinds).join());
kinds.inner.deep = "changed";
console.log(kinds.inner.deep, tryTo(() => { "use strict"; kinds.count = 1; return "stored"; }), kinds.count);

class Gauge {
  constructor(step) {
    Object.defineProperty(this, "step", { enumerable: false, value: step });
    Object.defineProperty(this, "move", { enumerable: true, value: at => at + this.step });
  }
}
const slow = new Gauge(1), fast = new Gauge(10);
let walked = 0;
for (let i = 0; i < 500; i++) walked += (i & 1 ? slow : fast).move(i);
console.log(walked, Object.keys(slow).join(), slow.step, fast.step, tryTo(() => { "use strict"; slow.step = 5; return "stored"; }));
