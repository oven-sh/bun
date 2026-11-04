let calls = 0, reads = 0, most = 0;
function tick() { calls++; }
const bound = tick.bind(null);
const descriptor = { get() { reads++; return 7; } };
function makeList() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  return list;
}
for (let i = 0; i < 300; i++) bound.apply(null, makeList());
console.log(calls, reads);
for (let i = 0; i < 300; i++) most += Math.max.apply(null, makeList());
console.log(most, reads);
const target = [];
for (let i = 0; i < 300; i++) Array.prototype.push.apply(target, makeList());
console.log(target.length, reads);
for (let i = 0; i < 300; i++) most += String.fromCharCode.apply(null, makeList()).length;
console.log(most, reads);
