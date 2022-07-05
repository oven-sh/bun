import { bench, run } from "mitata";

const { add3, noop } =
  "Bun" in globalThis
    ? require("./plus100-napi")
    : (await import("module")).createRequire(import.meta.url)("./plus100-napi");

bench("add3(1,2,3) napi", () => {
  add3(1, 2, 3);
});
bench("noop() napi", () => {
  noop();
});
await run({ collect: false, percentiles: true });
console.log("\n");

if (add3(1, 2, 3) !== 1 + 2 + 3) {
  throw new Error("plus100(1) !== 101");
}
