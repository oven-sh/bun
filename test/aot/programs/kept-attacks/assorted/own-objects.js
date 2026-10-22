// Assorted: own objects. It prints what plain Bun prints.
function definedNotRead(p) {
  const o = { a: p, n: 2 };
  return 1;
}
function readOtherKey(p) {
  const o = { a: p, n: 2 };
  return o.n;
}
function readOtherKeyDropped(p) {
  const o = { a: p, n: 2 };
  if (o.n === 3) return 2;
  return 1;
}
function readSameKeyDropped(p) {
  const o = { a: p };
  if (o.a === null) return 2;
  return 1;
}
function storedLaterNotRead(p) {
  const o = { a: null };
  o.a = p;
  return 1;
}
function computedMember(p) {
  const o = { tag: "s" + p.n, n: p.n + 4, a: p, b: null };
  return 1;
}
function computedMemberHanded(p) {
  const o = { tag: "s" + p.n, n: p.n + 4, a: p, b: null };
  return look(o);
}
function look(o) {
  return o.n;
}
function arrayReadDropped(p) {
  const l = [p];
  if (l.length === 3) return 2;
  return 1;
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  const p = { n: i, b: null };
  sum += definedNotRead(p) + readOtherKey(p) + readOtherKeyDropped(p) + readSameKeyDropped(p) + storedLaterNotRead(p) + computedMember(p) + computedMemberHanded(p) + arrayReadDropped(p);
}
console.log(sum);
