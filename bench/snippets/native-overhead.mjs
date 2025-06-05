import { noOpForTesting as noop } from "bun:internal-for-testing";
import { bench, run } from "../runner.mjs";

// These are no-op C++ functions that are exported to JS.
const fn = noop.function;
const callback = noop.callback;

bench("C++ callback into JS", () => {
  callback(() => {});
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
