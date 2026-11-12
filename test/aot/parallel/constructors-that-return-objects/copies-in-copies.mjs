function Inner(n) {
  this.x = n;
  if (n > 2) return { x: n * 10 };
}
function Outer(n) {
  const inner = new Inner(n);
  this.x = inner.x;
  if (n === 4) return inner;
}
function middle(n) {
  const one = new Outer(n);
  return one.x;
}
function work(n) {
  const first = middle(n);
  return first + middle(n + 1);
}
for (const n of [0, 1, 2, 3, 4]) console.log(work(n));
console.log([1, 2, 3, 4].map(n => new Outer(n).x).join());
