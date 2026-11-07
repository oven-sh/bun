import { test } from "bun:test";
function ask(n: number) { const boxed = new Number(n); return `${boxed}` + (boxed as any + 1); }
test("number-as-text-calls-to-string", () => {
  let calls = 0; let seen: unknown = "";
  const realS = Number.prototype.toString, realV = Number.prototype.valueOf; Number.prototype.toString = function () { calls++; return "S"; }; Number.prototype.valueOf = function () { calls++; return 100; };
  try {
    for (let i = 0; i < 300; i++) seen = ask(i);
  } finally {
    Number.prototype.toString = realS; Number.prototype.valueOf = realV;
  }
  console.log(String(seen), calls);
});
