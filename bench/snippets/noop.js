import { bench, run } from "../runner.mjs";

var noop = globalThis[Symbol.for("Bun.lazy")]("noop");
var { function: noopFn, callback } = noop;
const noop2 = () => {};

bench("function", function () {
  noopFn();
});

bench("JSC::call(() => {})", () => {
  callback(noop2);
});

const bound = noop2.bind(null);
bench("bound call", () => {
  bound();
});

bench("setter", function () {
  noop.getterSetter = 1;
});

bench("getter", function () {
  noop.getterSetter;
});

run();
