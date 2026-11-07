import { test } from "bun:test";
function ask(text: string) { return text.replace(/b+/, "x") + text.split(/c+/).length + text.replaceAll(/b+/g, "y"); }
test("replace-calls-exec", () => {
  let calls = 0; let seen: unknown = "";
  const real = RegExp.prototype.exec; RegExp.prototype.exec = function (this: RegExp, text: string) { calls++; return real.call(this, text); };
  try {
    for (let i = 0; i < 300; i++) seen = ask("abcb");
  } finally {
    RegExp.prototype.exec = real;
  }
  console.log(String(seen), calls);
});
