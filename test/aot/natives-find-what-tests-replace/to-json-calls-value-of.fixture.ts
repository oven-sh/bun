import { test } from "bun:test";
function ask(ms: number) { const date = new Date(ms); return date.toJSON(); }
test("to-json-calls-value-of", () => {
  let calls = 0; let seen: unknown = "";
  const real = Date.prototype.valueOf; Date.prototype.valueOf = function () { calls++; return NaN; };
  try {
    for (let i = 0; i < 300; i++) seen = ask(i);
  } finally {
    Date.prototype.valueOf = real;
  }
  console.log(String(seen), calls);
});
