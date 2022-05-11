import { bench, run } from "mitata";

const { plus100, noop } =
  "Bun" in globalThis
    ? require("./plus100-napi")
    : (await import("module")).createRequire(import.meta.url)("./plus100-napi");

bench("plus100(1) napi", () => {
  plus100(1);
});
bench("noop() napi", () => {
  noop();
});
await run({ collect: false, percentiles: true });
console.log("\n");

if (plus100(1) !== 101) {
  throw new Error("plus100(1) !== 101");
}
