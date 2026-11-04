let calls = 0, reads = 0;
async function later() { calls++; }
function* steps() { calls++; yield 1; }
const descriptor = { get() { reads++; return 1; } };
function makeList() {
  const list = [1, 2];
  Object.defineProperty(list, 1, descriptor);
  return list;
}
for (let i = 0; i < 300; i++) later.apply(null, makeList());
console.log(calls, reads);
for (let i = 0; i < 300; i++) steps.apply(null, makeList()).next();
console.log(calls, reads);
