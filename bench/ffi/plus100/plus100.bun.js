import { run, bench, group, baseline } from "mitata";
import { dlopen, suffix } from "bun:ffi";

const {
  symbols: {
    plus100: { native: plus100 },
    noop,
  },
  close,
} = dlopen(`./plus100.${suffix}`, {
  plus100: {
    args: ["int32_t"],
    returns: "int32_t",
  },
  noop: {
    args: [],
  },
});
bench("plus100(1) ", () => {
  plus100(1);
});

bench("noop() ", () => {
  noop();
});

// collect option collects benchmark returned values into array
// prevents gc and can help with jit optimizing out functions
await run({ collect: false, percentiles: true });
console.log("\n");

if (plus100(1) !== 101) {
  throw new Error("plus100(1) !== 101");
}
