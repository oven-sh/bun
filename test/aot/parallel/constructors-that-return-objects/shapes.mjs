function Made(n) {
  this.x = n;
  if (n === 2) return { x: 41 };
  if (n === 3) return { y: 1, x: "text" };
  if (n === 4) return [7];
  if (n === 5) return "a primitive";
}
Made.prototype.tell = function () {
  return "told " + this.x;
};
function work(n) {
  const one = new Made(n);
  return one.x;
}
function tell(n) {
  const one = new Made(n);
  return one.tell?.();
}
for (const n of [1, 2, 3, 4, 5, 6]) console.log(work(n), tell(n));
