// Functions that run where the build cannot follow them return, throw and yield node:util. Its members are then called under computed names.
import * as util from "node:util";
const hide = value => new CustomEvent("x", { detail: value }).detail;
console.log(hide(() => util)()[hide("stripVTControlCharacters")]("\u001b[31mred\u001b[0m"));
try {
  hide(() => {
    throw util;
  })();
} catch (thrown) {
  console.log(thrown[hide("isDeepStrictEqual")]({ a: [1] }, { a: [1] }));
}
for (const yielded of hide(function* () {
  yield util;
})())
  console.log(yielded[hide("styleText")]("bold", "x").length > 1);
