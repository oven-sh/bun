let calls = 0, reads = 0;
function tick() { calls++; }
const holder = { tick() { calls++; } };
const descriptor = { get() { reads++; return 1; } };
function makeList() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  return list;
}
function plain() { tick(...makeList()); }
function behindOne() { tick(0, ...makeList()); }
function method() { holder.tick(...makeList()); }
for (let i = 0; i < 300; i++) plain();
console.log(calls, reads);
for (let i = 0; i < 300; i++) behindOne();
console.log(calls, reads);
for (let i = 0; i < 300; i++) method();
console.log(calls, reads);
