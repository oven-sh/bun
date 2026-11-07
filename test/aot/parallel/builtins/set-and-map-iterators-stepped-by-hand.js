// next() of Set and Map iterators, called by hand, while the collection changes and on values that are not iterators.
const lines = [];
const show = (...values) =>
  lines.push(
    values.map((value) => JSON.stringify(value) ?? String(value)).join(" "),
  );
function walk(iterator) {
  const seen = [];
  for (let step = iterator.next(); !step.done; step = iterator.next())
    seen.push(step.value);
  return seen;
}
const set = new Set([1, "two", 3.5, null, undefined, true]);
const map = new Map([
  ["a", 1],
  [2, "b"],
  [null, undefined],
]);
show(
  walk(set.values()),
  walk(set.keys()),
  walk(set.entries()),
  walk(set[Symbol.iterator]()),
);
show(
  walk(map.values()),
  walk(map.keys()),
  walk(map.entries()),
  walk(map[Symbol.iterator]()),
);

const finished = new Set([1]).values();
show(finished.next(), finished.next(), finished.next());
const emptyAtFirst = new Set();
const late = emptyAtFirst.values();
emptyAtFirst.add("late");
show(late.next(), late.next());
const closes = new Set();
const closed = closes.values();
show(closed.next());
closes.add(1);
show(closed.next());
const emptyMap = new Map();
const lateKeys = emptyMap.keys();
emptyMap.set("k", "v");
show(lateKeys.next(), lateKeys.next());

const growing = new Set([0]);
const grown = [];
for (
  const it = growing.values(), s = { step: it.next() };
  !s.step.done;
  s.step = it.next()
) {
  grown.push(s.step.value);
  if (s.step.value < 100) growing.add(s.step.value + 1);
}
show(grown.length, grown[100]);
const shrinking = new Set([1, 2, 3, 4, 5]);
const down = shrinking.values();
show(down.next().value);
shrinking.delete(2);
shrinking.delete(3);
show(down.next().value);
shrinking.delete(1);
shrinking.add(1);
show(walk(down));
const cleared = new Map([
  [1, 1],
  [2, 2],
]);
const afterClear = cleared.entries();
show(afterClear.next().value);
cleared.clear();
cleared.set(3, 3);
show(walk(afterClear));
const big = new Set();
const bigWalk = big.values();
for (let i = 0; i < 5000; i++) big.add("key" + i);
let total = 0;
for (let step = bigWalk.next(); !step.done; step = bigWalk.next())
  total += step.value.length;
show(total);
const numbers = new Set();
for (let i = 0; i < 3000; i++) numbers.add(i * 1.5);
show(walk(numbers.values()).reduce((a, b) => a + b, 0));
const moving = new Map();
for (let i = 0; i < 20; i++) moving.set(i, i);
const movingWalk = moving.entries();
const moved = [];
for (let step = movingWalk.next(); !step.done; step = movingWalk.next()) {
  moved.push(step.value[0]);
  if (step.value[0] % 2) moving.delete(step.value[0] + 1);
  if (moved.length === 5) for (let i = 100; i < 400; i++) moving.set(i, i);
}
show(moved.length, moved.slice(0, 8));

const setNext = Object.getPrototypeOf(new Set().values()).next;
const mapNext = Object.getPrototypeOf(new Map().values()).next;
show(
  setNext.name,
  setNext.length,
  mapNext.name,
  mapNext.length,
  typeof setNext,
  setNext !== mapNext,
);
show(String(setNext), String(mapNext));
show(
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(new Set().values()),
    "next",
  ).writable,
);
for (const receiver of [
  undefined,
  null,
  1,
  "s",
  {},
  [],
  new Set(),
  new Map(),
  [].values(),
  new Map().values(),
])
  try {
    show(setNext.call(receiver));
  } catch (error) {
    show(error.name, error.message);
  }
for (const receiver of [undefined, {}, new Map(), new Set().values()])
  try {
    show(mapNext.call(receiver));
  } catch (error) {
    show(error.name, error.message);
  }
const pair = new Map([["k", "v"]]).entries().next();
show(
  pair,
  Object.keys(pair),
  Array.isArray(pair.value),
  Object.getPrototypeOf(pair) === Object.prototype,
);
const callNext = (iterator, next) => next.call(iterator);
show(
  callNext(new Set([9]).values(), setNext),
  callNext(new Map([[8, 7]]).values(), mapNext),
);
const held = [];
const objects = new Set([{ n: 1 }, { n: 2 }]).values();
for (let step = objects.next(); !step.done; step = objects.next())
  held.push(step.value);
Bun.gc(true);
show(held);
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const it = new Set([i, i + 1]).values();
  sum += it.next().value + it.next().value + (it.next().done ? 1 : 0);
}
show(sum, new Map([["first", 1]]).keys().next().value);
console.log(lines.join("\n"));
