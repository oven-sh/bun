function Made(n) {
  this.x = n;
  if (n > 2) return { x: 41 };
  return null;
}
function work(n) {
  if (new Made(n)) return "object";
  return "nothing";
}
function read(n) {
  const one = new Made(n);
  return one === null || one === undefined ? "nothing" : one?.x;
}
for (const n of [1, 2, 3, 4]) console.log(work(n), read(n));
