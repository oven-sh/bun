// A loop calls a function that calls path.parse(), and a line that never runs puts a Proxy in that function's place.
// STATISTIC: NativeFunctionTestsEmitted >= 1
import * as path from "node:path";

function parseNumbered(n: number) {
  return path.parse("/a/b" + n + ".c");
}

function parseMany() {
  let last: unknown = 0;
  for (let i = 0; i < 200; i++) last = parseNumbered(i);
  return last;
}

function replace() {
  // @ts-ignore
  parseNumbered = new Proxy(parseNumbered, {});
}

let printed = "";
for (let n = 0; n < 3; n++) {
  printed = JSON.stringify(parseMany());
  console.log(n, printed);
}
if (printed === "") replace();
