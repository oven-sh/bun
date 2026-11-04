let reads = 0;
const parent = Object.create(Array.prototype);
Object.setPrototypeOf([], parent);
Object.defineProperty(parent, 1, { get() { reads++; return 9; } });
let last = null;
function step(n, hole, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1, , acc + 1];
  last = list;
  return step.apply(null, list);
}
function full(n, middle, acc) {
  if (n === 0) return acc + middle;
  return full.apply(null, [n - 1, 3, acc + 1]);
}
function like(n, hole, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  return like.apply(null, { length: 3, 0: n - 1, 2: acc + 1 });
}
function spread(n, hole, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1, , acc + 1];
  return spread(...list);
}
for (const deed of [step, full, like, spread]) {
  let answer;
  try { answer = String(deed(300000, deed === full ? 3 : undefined, 0)); } catch (error) { answer = error.constructor.name; }
  console.log(deed.name, answer);
}
console.log(last.length, 1 in last, reads);
