import { run, bench, group, baseline } from "https://esm.sh/mitata";

const {
  symbols: { add3: add3, noop },
  close,
} = Deno.dlopen("./plus100.dylib", {
  add3: {
    parameters: ["i32", "i32", "i32"],
    result: "i32",
  },
  noop: {
    parameters: [],
    result: "void",
  },
});
bench("add3(1,2,3) ", () => {
  add3(1, 2, 3);
});

bench("noop() ", () => {
  noop();
});

// collect option collects benchmark returned values into array
// prevents gc and can help with jit optimizing out functions
await run({ collect: false, percentiles: true });

if (add3(1, 2, 3) !== 1 + 2 + 3) {
  throw new Error("add3(1) !== 101");
}
