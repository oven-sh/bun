function Made(n) {
  this.x = n;
  if (n > 2) return { x: 41 };
}
function work(n) {
  const one = new Made(n);
  return one.x;
}
for (const n of [1, 2, 3, 4]) console.log(work(n));
