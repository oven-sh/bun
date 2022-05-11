import { run, bench, group, baseline } from "mitata";
import { dlopen, suffix } from "bun:ffi";
import { readdirSync } from "fs";

const {
  symbols: {
    plus100: { native: plus100 },
    noop,
  },
  close,
} = dlopen(`./plus100.dylib`, {
  plus100: {
    args: ["int32_t"],
    returns: "int32_t",
  },
  noop: {
    args: [],
  },
});
const {
  plus100: plus100napi,
  noop: noopNapi,
} = require("./plus100-napi/index.js");

group("plus100", () => {
  bench("plus100(1) ffi", () => {
    plus100(1);
  });

  bench("plus100(1) napi", () => {
    plus100napi(1);
  });
});

group("noop", () => {
  bench("noop() ffi", () => {
    noop();
  });

  bench("noop() napi", () => {
    noopNapi();
  });
});

// collect option collects benchmark returned values into array
// prevents gc and can help with jit optimizing out functions
await run({ collect: false, percentiles: true });
console.log("\n");

if (plus100(1) !== 101) {
  throw new Error("plus100(1) !== 101");
}
