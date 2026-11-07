import { test } from "bun:test";
function ask(ms: number) { const date = new Date(ms), other = new Date(ms + 1); return +date + ":" + (other.valueOf() - ms) + ":" + ((date as any) - 0) + ":" + (date < other) + ":" + Number(date); }
test("date-as-number-calls-value-of", () => {
  let calls = 0; let seen: unknown = "";
  const real = Date.prototype.valueOf; Date.prototype.valueOf = function () { calls++; return 7; };
  try {
    for (let i = 0; i < 300; i++) seen = ask(i);
  } finally {
    Date.prototype.valueOf = real;
  }
  console.log(String(seen), calls);
});
