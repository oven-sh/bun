// A function makes an error and is called through a Proxy without an apply trap, three times from one function, then in tail position, then after the handler got a trap.
// The stack lists a frame for the proxy while the proxy has not yet learned that its handler has no trap. The output is that of plain Bun.
"use strict";
function names(error) {
  return error.stack
    .split("\n")
    .slice(1, 6)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*$/, ""))
    .join(" < ");
}
function inner() {
  return names(new Error("here"));
}
const handler = {};
const proxyOfInner = new Proxy(inner, handler);
function outer() {
  return "" + proxyOfInner();
}
function outerTail() {
  return proxyOfInner();
}
function main() {
  for (let i = 0; i < 3; i++) console.log(outer());
  console.log("" + outerTail());
  handler.apply = (target, self, list) => "trap: " + Reflect.apply(target, self, list);
  console.log(outer());
}
main();
