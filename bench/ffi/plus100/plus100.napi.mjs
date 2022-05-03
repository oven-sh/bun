import { bench, run } from "mitata";

import module from "module";

const { plus100 } = module.createRequire(import.meta.url)("./plus100-napi");

bench("plus100(1) (napi.rs)", () => {
  plus100(1);
});
run({ collect: false, percentiles: true });
