let calls = 0, reads = 0, sum = 0;
function withDefault(first = 5) { calls++; sum += first; }
function withPattern({ size } = { size: 2 }) { calls++; sum += size; }
const descriptor = { get() { reads++; return undefined; } };
function makeList() {
  const list = [undefined, 2, 3];
  Object.defineProperty(list, 0, descriptor);
  Object.defineProperty(list, 2, descriptor);
  return list;
}
for (let i = 0; i < 300; i++) withDefault.apply(null, makeList());
console.log(calls, reads, sum);
for (let i = 0; i < 300; i++) withPattern.apply(null, makeList());
console.log(calls, reads, sum);
