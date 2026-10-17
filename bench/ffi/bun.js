import { cc, CString, dlopen, ptr } from "bun:ffi";
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

const {
  symbols: { cc_noop, cc_sink, cc_identity, cc_add, cc_sum10, cc_sum_of_squares, cc_is_null, cc_same },
} = cc({
  source: import.meta.dir + "/cc.c",
  symbols: {
    cc_noop: { args: [], returns: "void" },
    cc_sink: { args: ["i32"], returns: "void" },
    cc_identity: { args: ["i32"], returns: "i32" },
    cc_add: { args: ["i32", "i32"], returns: "i32" },
    cc_sum10: { args: Array(10).fill("i32"), returns: "i32" },
    cc_sum_of_squares: { args: ["f64", "f64"], returns: "f64" },
    cc_is_null: { args: ["ptr"], returns: "bool" },
    cc_same: { args: ["ptr", "ptr"], returns: "bool" },
  },
});

group("bun:ffi cc()", () => {
  bench("noop", () => cc_noop());
  bench("sink(i32)", () => cc_sink(1));
  bench("identity(i32)", () => cc_identity(1));
  bench("add(i32, i32)", () => cc_add(1, 2));
  bench("sum10(i32 x 10)", () => cc_sum10(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  bench("sum_of_squares(f64, f64)", () => cc_sum_of_squares(1.5, 2.5));
  bench("is_null(ptr): raw pointer", () => cc_is_null(strPtr));
  bench("is_null(ptr): TypedArray", () => cc_is_null(strBuf));
  bench("same(ptr, ptr)", () => cc_same(strPtr, strBuf));
  bench("add(i32, i32), one argument missing", () => cc_add(1));
});

if (process.env.SHOW_NAPI)
  group("bun:napi", () => {
    bench("noop", () => napiNoop());
    bench("hash", () => napiHash(bytes));

    bench("string", () => napiString());
  });

await run();
