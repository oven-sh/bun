import { run, bench, group, baseline } from "https://esm.sh/mitata";

const {
  symbols: { plus100: plus100 },
  close,
} = Deno.dlopen("./plus100.dylib", {
  plus100: {
    parameters: ["i32"],
    result: "i32",
  },
});
bench("plus100(1) (Deno FFI)", () => {
  plus100(1);
});

// collect option collects benchmark returned values into array
// prevents gc and can help with jit optimizing out functions
run({ collect: false, percentiles: true });
