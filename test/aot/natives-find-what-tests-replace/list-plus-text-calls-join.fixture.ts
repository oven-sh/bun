import { test } from "bun:test";
function ask(a: number, b: number) { const list = [a, b]; return list + "" + `${list}` + String(list); }
test("list-plus-text-calls-join", () => {
  let calls = 0; let seen: unknown = "";
  const real = Array.prototype.join; Array.prototype.join = function () { calls++; return "replaced"; };
  try {
    for (let i = 0; i < 300; i++) seen = ask(i, 1);
  } finally {
    Array.prototype.join = real;
  }
  console.log(String(seen), calls);
});
