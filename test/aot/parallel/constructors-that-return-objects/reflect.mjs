function Made(n) {
  this.x = n;
  if (n > 2) return { x: 41 };
}
Made.prototype.kind = "made";
class Other {
  get kind() {
    return "other";
  }
}
function construct(n) {
  const one = Reflect.construct(Made, [n]);
  return one.x;
}
function withTarget(n) {
  const one = Reflect.construct(Made, [n], Other);
  return one.kind + one.x;
}
function spread(list) {
  const one = new Made(...list);
  return one.x;
}
for (const n of [1, 2, 3, 4]) console.log(construct(n), withTarget(n), spread([n]));
