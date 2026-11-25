import { test } from "bun:test";
function uses(text: string) {
  return text.search(/c+/) + text.match(/b+/)!.index! + (/b+/.test(text) ? 1 : 0);
}
test("what matches calls the exec that it finds", () => {
  let calls = 0, sum = 0;
  const real = RegExp.prototype.exec;
  RegExp.prototype.exec = function (this: RegExp, text: string) { calls++; return real.call(this, text); };
  try {
    for (let i = 0; i < 300; i++) sum += uses("abcb");
  } finally {
    RegExp.prototype.exec = real;
  }
  console.log(calls, sum);
});
