import { run, bench, group, baseline } from "https://esm.sh/mitata";

const {
  symbols: { plus100: plus100, noop },
  close,
} = Deno.dlopen("./plus100.dylib", {
  plus100: {
    parameters: ["i32"],
    result: "i32",
  },
  noop: {
    parameters: [],
    result: "void",
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

if (plus100(1) !== 101) {
  throw new Error("plus100(1) !== 101");
}
