import { test } from "bun:test";
function ask() { const a = new Set([1, 2]), b = new Set([2, 3]); return a.union(b).size; }
test("union-calls-keys", () => {
  let calls = 0; let seen: unknown = "";
  const real = Set.prototype.keys; Set.prototype.keys = function (this: Set<unknown>) { calls++; return real.call(this); } as any;
  try {
    for (let i = 0; i < 300; i++) seen = ask();
  } finally {
    Set.prototype.keys = real;
  }
  console.log(String(seen), calls);
});
