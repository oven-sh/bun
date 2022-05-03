import { bench, run } from "mitata";

import module from "module";

const { plus100, noop } = module.createRequire(import.meta.url)(
  "./plus100-napi"
);

bench("plus100(1) ", () => {
  plus100(1);
});
bench("noop() ", () => {
  noop();
});
await run({ collect: false, percentiles: true });
console.log("\n");

if (plus100(1) !== 101) {
  throw new Error("plus100(1) !== 101");
}
