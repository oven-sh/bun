import { dlopen } from "bun:ffi";
import { bench, run } from "mitata";

const {
  symbols: { noop },
} = dlopen("./noop.dylib", {
  noop: {
    args: [],
    return_type: "i32",
  },
});
var raw = Object.keys(noop);
bench("noop", () => {
  raw();
});
run({ collect: false, percentiles: true });
