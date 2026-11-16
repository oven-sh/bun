// WebAssembly written into the source as text is compiled at build time, whichever way the program decodes it. Each module here is a different one.
// STATISTIC: WasmFunctionsCompiled = 10
// STATISTIC: WasmOptimizedCopies = 10
// STATISTIC: WasmBaselineCopies = 0
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 0
// COUNTER in every build: WasmInstancesUsingImageCode = 10
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 10
const answer = bytes => new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.answer();
const held = "AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoHAQUAQZQDCwAMB21hZGUtdXABAgME";
console.log("atob", answer(Uint8Array.from(atob("AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoHAQUAQeUACwAMB21hZGUtdXABAgME"), character => character.charCodeAt(0))));
console.log("Uint8Array.fromBase64", answer(Uint8Array.fromBase64("AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoHAQUAQcoBCwAMB21hZGUtdXABAgME")));
console.log("Buffer.from, base64", answer(Buffer.from("AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoHAQUAQa8CCwAMB21hZGUtdXABAgME", "base64")));
console.log("Buffer.from, base64, through a constant", answer(Buffer.from(held, "base64")));
console.log("Buffer.from, base64url", answer(Buffer.from("AGFzbQEAAAABBQFgAAF_AwIBAAcKAQZhbnN3ZXIAAAoHAQUAQcMFCwAMB21hZGUtdXDw8PD-", "base64url")));
console.log("Buffer.from, hex", answer(Buffer.from("0061736d010000000105016000017f03020100070a0106616e7377657200000a0701050041f9030b000c076d6164652d757001020304", "hex")));
console.log("a data: URL", answer(await (await fetch("data:application/wasm;base64,AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoHAQUAQd4ECwAMB21hZGUtdXABAgME")).arrayBuffer()));
console.log("a module of 34 bytes, base64", new WebAssembly.Instance(new WebAssembly.Module(Buffer.from("AGFzbQEAAAABBQFgAAF/AwIBAAcFAQFhAAAKBgEEAEEqCw==", "base64"))).exports.a());
console.log("a module of 27 bytes, hex", Object.keys(new WebAssembly.Instance(new WebAssembly.Module(Buffer.from("0061736d010000000105016000017f030201000a06010400412b0b", "hex"))).exports).length);
console.log("base64 over two lines", answer(Buffer.from(`AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIA
AAoHAQUAQagGCwAMB21hZGUtdXABAgME`, "base64")));
