import { bench, group, run } from "mitata";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { napiNoop, napiHash, napiString } = require("./src/ffi_napi_bench.node");

const bytes = new Uint8Array(64);

group("napi", () => {
  bench("noop", () => napiNoop());
  bench("hash", () => napiHash(bytes));

  bench("string", () => napiString());
});

await run();
