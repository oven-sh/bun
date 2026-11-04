let calls = 0, reads = 0;
function tick() { calls++; return calls; }
const descriptor = { get() { reads++; return 1; } };
function makeList() {
  const list = [1, 2];
  Object.defineProperty(list, 1, descriptor);
  return list;
}
function byApply(list) { "use strict"; return tick.apply(null, list); }
function byReflect(list) { "use strict"; return Reflect.apply(tick, null, list); }
let last = 0;
for (let i = 0; i < 300; i++) last = byApply(makeList());
console.log(calls, reads, last);
for (let i = 0; i < 300; i++) last = byReflect(makeList());
console.log(calls, reads, last);
