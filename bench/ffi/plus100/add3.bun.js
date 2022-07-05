import { run, bench, group, baseline } from "mitata";
import { dlopen, suffix } from "bun:ffi";
import { readdirSync } from "fs";

const {
  symbols: {
    add3: { native: add3 },
    noop,
  },
  close,
} = dlopen(`./plus100.dylib`, {
  add3: {
    args: ["int32_t", "int32_t", "int32_t"],
    returns: "int32_t",
  },
  noop: {
    args: [],
  },
});
const { add3: add3napi, noop: noopNapi } = require("./plus100-napi/index.js");

group("add3", () => {
  bench("add3(1,2,3) ffi", () => {
    add3(1, 2, 3);
  });

  bench("add3(1,2,3) napi", () => {
    add3napi(1, 2, 3);
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

if (add3(1, 2, 3) !== 1 + 2 + 3) {
  throw new Error("add3(1) !== 101");
}
