// structuredClone runs the getters of what it copies, so a variable that a getter writes has another value after the call.
let count = 0;
function cloneAndCount() {
  const source = { a: 1, get g() { count++; return count; } };
  const before = count;
  const copy = structuredClone(source);
  const after = count;
  return [before, after, copy.g, after - before];
}
console.log(cloneAndCount().join());
console.log(cloneAndCount().join());
let total = 0;
for (let i = 0; i < 5; i++) total += cloneAndCount()[3];
console.log(total, count);
