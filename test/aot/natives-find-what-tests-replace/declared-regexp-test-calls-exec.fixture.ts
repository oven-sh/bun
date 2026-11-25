import { test } from "bun:test";
function ask(re: RegExp, text: string) { return re.test(text); }
const pattern = /b+/;
test("declared-regexp-test-calls-exec", () => {
  let calls = 0; let seen: unknown = "";
  const real = RegExp.prototype.exec; RegExp.prototype.exec = function (this: RegExp, text: string) { calls++; return real.call(this, text); };
  try {
    for (let i = 0; i < 300; i++) seen = ask(pattern, "abcb");
  } finally {
    RegExp.prototype.exec = real;
  }
  console.log(String(seen), calls);
});
