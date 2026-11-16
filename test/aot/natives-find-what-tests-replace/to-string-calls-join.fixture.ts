import { test } from "bun:test";
function text(a: number, b: number) {
  const list = [a, b];
  return list.toString();
}
test("toString calls the join that it finds", () => {
  const real = Array.prototype.join;
  Array.prototype.join = function () { return "replaced"; };
  let seen = "";
  try {
    for (let i = 0; i < 300; i++) seen = text(i, i + 1);
  } finally {
    Array.prototype.join = real;
  }
  console.log(seen);
});
