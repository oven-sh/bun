let calls = 0, reads = 0;
function tick() { calls++; }
function hand(list) { return pass(list); }
function pass(list) { tick.apply(undefined, list); return list.length; }
function makeList() {
  const list = [1, 2, 3];
  Object.defineProperty(list, 1, { get() { reads++; return 1; } });
  return list;
}
let total = 0;
for (let i = 0; i < 300; i++) total += hand(makeList());
console.log(calls, reads, total);
for (let i = 0; i < 300; i++) total += hand([i, i]);
console.log(calls, reads, total);
