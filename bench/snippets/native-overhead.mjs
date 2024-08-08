import { bench, run } from "./runner.mjs";

// These are no-op C++ functions that are exported to JS.
const lazy = globalThis[Symbol.for("Bun.lazy")];
const noop = lazy("noop");
const fn = noop.function;
const regular = noop.functionRegular;
const callback = noop.callback;

bench("C++ callback into JS", () => {
  callback(() => {});
});

bench("C++ fn regular", () => {
  regular();
});

bench("C++ fn", () => {
  fn();
});

bench("C++ getter", () => {
  return noop.getterSetter;
});

bench("C++ setter", () => {
  noop.getterSetter = 1;
});

run();
