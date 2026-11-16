import { test } from "bun:test";
const box = { n: 0 };
function own() {
  const a = new Set([1, 2]), b = new Set([2, 3, 4]);
  const before = box.n;
  const answer = a.isSubsetOf(b);
  return (box.n - before) * 10 + (answer ? 1 : 0);
}
test("isSubsetOf calls the has that it finds", () => {
  const real = Set.prototype.has;
  Set.prototype.has = function (this: Set<unknown>, item: unknown) { box.n++; return real.call(this, item); };
  let seen = -1;
  try {
    for (let i = 0; i < 300; i++) seen = own();
  } finally {
    Set.prototype.has = real;
  }
  console.log(seen);
});
