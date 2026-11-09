import { test } from "bun:test";
function ask(ms: number) { const date = new Date(ms); return `${date}` + "|" + (date + "") + "|" + String(date); }
test("date-as-text-calls-to-string", () => {
  let calls = 0; let seen: unknown = "";
  const real = Date.prototype.toString; Date.prototype.toString = function () { calls++; return "replaced"; };
  try {
    for (let i = 0; i < 300; i++) seen = ask(i);
  } finally {
    Date.prototype.toString = real;
  }
  console.log(String(seen), calls);
});
