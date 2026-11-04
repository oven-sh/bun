let calls = 0, reads = 0, seen = 0;
const box = { level: 0 };
function tick() { calls++; }
function makeList() {
  const list = [1, 2];
  Object.defineProperty(list, 1, { get() { reads++; box.level++; return 2; } });
  return list;
}
function inner(list) { tick.apply(null, list); }
function here(list) {
  const before = reads, level = box.level;
  tick.apply(null, list);
  return (reads - before) + (box.level - level);
}
function above(list) {
  const before = reads, level = box.level;
  inner(list);
  return (reads - before) + (box.level - level);
}
for (let i = 0; i < 300; i++) seen += here(makeList());
console.log(calls, reads, seen);
for (let i = 0; i < 300; i++) seen += above(makeList());
console.log(calls, reads, seen);
