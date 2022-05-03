import { run, bench, group, baseline } from "mitata";
import { dlopen } from "bun:ffi";

const {
  symbols: { plus100: plus100 },
  close,
} = dlopen("./plus100.dylib", {
  plus100: {
    params: ["int32_t"],
    returns: "int32_t",
  },
});
bench("plus100(1) (Bun FFI)", () => {
  plus100(1);
});

// collect option collects benchmark returned values into array
// prevents gc and can help with jit optimizing out functions
run({ collect: false, percentiles: true });
