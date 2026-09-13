import { CString, dlopen, ptr } from "bun:ffi";
import { bench, group, run } from "../runner.mjs";

const { napiNoop, napiHash, napiString } = require(import.meta.dir + "/src/ffi_napi_bench.node");

const {
  symbols: {
    ffi_noop: { native: ffi_noop },
    ffi_hash: { native: ffi_hash },
    ffi_string: { native: ffi_string },
    ffi_strlen: { native: ffi_strlen },
  },
} = dlopen(import.meta.dir + "/src/ffi_napi_bench.node", {
  ffi_noop: { args: [], returns: "void" },
  ffi_string: { args: [], returns: "ptr" },
  ffi_hash: { args: ["ptr", "u32"], returns: "u32" },
  ffi_strlen: { args: ["cstring"], returns: "u32" },
});

const bytes = new Uint8Array(64);
const str36 = "550e8400-e29b-41d4-a716-446655440000";
const strBuf = Buffer.from(str36 + "\0", "utf8");
const strPtr = ptr(strBuf);
const cachedCString = new CString(strPtr);

group("bun:ffi", () => {
  bench("noop", () => ffi_noop());
  bench("hash", () => ffi_hash(ptr(bytes), bytes.byteLength));

  bench("c string", () => new CString(ffi_string()));

  bench("string arg: JS string", () => ffi_strlen(str36));
  bench("string arg: cached CString", () => ffi_strlen(cachedCString));
  bench("string arg: raw pointer", () => ffi_strlen(strPtr));
  bench("string arg: TypedArray", () => ffi_strlen(strBuf));
});

if (process.env.SHOW_NAPI)
  group("bun:napi", () => {
    bench("noop", () => napiNoop());
    bench("hash", () => napiHash(bytes));

    bench("string", () => napiString());
  });

await run();
