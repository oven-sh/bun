// bun:ffi throws validation errors with the same name, code and top two frames as `bun run`. native.dlopen returns the error instead.
import { CFunction, dlopen, JSCallback, linkSymbols, native, viewSource } from "bun:ffi";

const frames = error =>
  error.stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().replace(/ \(.*$/, ""))
    .join(" | ");

function show(label, run) {
  try {
    const result = run();
    console.log(label, "returns", Error.isError(result) ? result.name + " " + result.code : typeof result);
  } catch (error) {
    console.log(label, "throws", error.name, String(error.code), frames(error));
  }
}

show("missing library", () => dlopen("no-such-library", { abs: {} }));
show("dlopen()", () => dlopen());
show("empty symbols", () => dlopen("no-such-library", {}));
show("symbols is a number", () => dlopen("no-such-library", 1));
show("signature is a number", () => dlopen("no-such-library", { abs: 1 }));
show("unknown type", () => dlopen("no-such-library", { abs: { args: ["nope"] } }));
show("napi_env", () => linkSymbols({ a: { ptr: 8, args: ["napi_env"], returns: "void" } }));
show("napi_value", () => CFunction({ ptr: 8, args: [], returns: "napi_value" }));
show("napi_value in a callback", () => new JSCallback(() => 1, { args: ["napi_value"], returns: "i32" }));
show("linkSymbols()", () => linkSymbols());
show("linkSymbols without ptr", () => linkSymbols({ a: {} }));
show("CFunction()", () => CFunction());
show("CFunction without ptr", () => CFunction({}));
show("new JSCallback()", () => new JSCallback());
show("JSCallback of a number", () => new JSCallback(1, {}));
show("viewSource()", () => viewSource());
show("viewSource(1, true)", () => viewSource(1, true));
show("native.dlopen of a missing library", () => native.dlopen("no-such-library", { abs: {} }));
show("native.dlopen()", () => native.dlopen());
console.log(Object.keys(Bun.FFI).join());
