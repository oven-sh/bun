import { run, bench, group } from "../node_modules/mitata/src/cli.mjs";

const extension = "darwin" !== Deno.build.os ? "so" : "dylib";
const path = new URL(
  "src/target/release/libffi_napi_bench." + extension,
  import.meta.url
).pathname;

const {
  symbols: { ffi_noop, ffi_hash, ffi_string },
} = Deno.dlopen(path, {
  ffi_noop: { parameters: [], result: "void" },
  ffi_string: { parameters: [], result: "pointer" },
  ffi_hash: { parameters: ["usize", "usize"], result: "u32" },
});

const bytes = new Uint8Array(64);
// Deno represents pointers as bigint.
// Coerce to number for a better comparison.
const bytesPtr = Number(Deno.UnsafePointer.of(bytes));

group("deno:ffi", () => {
  bench("noop", () => ffi_noop());
  bench("hash", () => ffi_hash(bytesPtr, bytes.byteLength));
  bench("c string", () =>
    new Deno.UnsafePointerView(ffi_string()).getCString()
  );
});

await run();
