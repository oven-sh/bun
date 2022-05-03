import { dlopen } from "bun:ffi";
import { bench, run } from "mitata";

const {
  symbols: { noop },
} = dlopen("./noop.dylib", {
  noop: {
    args: [],
    returns: "void",
  },
});
bench("noop", () => {
  noop();
});
run({ collect: false, percentiles: true });
