interface Narrow {
  a: number;
}
interface Wide {
  a: number;
  b: number;
  c?: number;
}
function build(extra: object) {
  const wide: Wide = Object.assign({ a: 1, z: 26 }, extra) as unknown as Narrow as unknown as Wide;
  return wide;
}
function total(wide: Wide) {
  return wide.a + wide.b + (wide.c ?? 0);
}
function first(narrow: Narrow) {
  return narrow.a;
}
const one = build({ b: 2 });
const two = build({ b: 2, c: 3, y: 25 });
console.log(total(one), total(two), first(one), first(two), Object.keys(one).join(), Object.keys(two).join());
console.log((one as unknown as { z: number }).z, (two as unknown as { y: number }).y, JSON.stringify([one, two]));
