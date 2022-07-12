import { bench, run } from "mitata";

var noop = globalThis[Symbol.for("Bun.lazy")]("noop");

bench("function", function () {
  noop.function();
});

bench("setter", function () {
  noop.getterSetter = 1;
});

bench("getter", function () {
  noop.getterSetter;
});

run();
