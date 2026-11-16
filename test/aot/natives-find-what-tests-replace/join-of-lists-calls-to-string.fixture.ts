import { test } from "bun:test";
function ask(a: number) { const rows = [[a, 1], [2]]; return rows.join(";"); }
test("join-of-lists-calls-to-string", () => {
  let calls = 0; let seen: unknown = "";
  const real = Array.prototype.toString; Array.prototype.toString = function () { calls++; return "replaced"; };
  try {
    for (let i = 0; i < 300; i++) seen = ask(i);
  } finally {
    Array.prototype.toString = real;
  }
  console.log(String(seen), calls);
});
