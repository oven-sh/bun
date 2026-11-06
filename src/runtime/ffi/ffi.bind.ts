import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::ffi::FFI" });

export const FFI = b.class({
  rustPath: "crate::ffi::FFI",
  internalFields: ["symbolsValue", "functionsValue"],
  proto: {
    close: { capability: "js", passThis: true },
    symbols: { internalField: "symbolsValue" },
  },
});

const method = { returns: b.any, feature: "Ffi", capability: "js", throws: true } as const;

// The functions of `Bun.FFI`. One that is given bad options returns the error.
export const viewSource = b.fn({
  ...method,
  export: "Bun__FFI__viewSource",
  args: { symbols: b.any, isCallback: b.bool.loose },
});
/** Without a `name` it throws. */
export const dlopen = b.fn({
  ...method,
  export: "Bun__FFI__dlopen",
  args: { name: b.string.loose.utf8.nullable, symbols: b.any },
});
export const callback = b.fn({ ...method, export: "Bun__FFI__callback", args: { options: b.any, callback: b.any } });
export const linkSymbols = b.fn({ ...method, export: "Bun__FFI__linkSymbols", args: { symbols: b.any } });
/** A callback that is closed has no address any more. */
export const closeCallback = b.fn({
  export: "Bun__FFI__closeCallback",
  feature: "Ffi",
  args: { callback: b.any },
  uses: { callback: [...table.handedOver, table.definesName(["ptr"], table.strictNull)] },
});
export const cfunction = b.fn({
  ...method,
  export: "Bun__FFI__cfunction",
  args: { options: b.any, name: b.string.allowStringObject.otherAsNull },
});

// `bun:ffi` calls these. Each wraps the `Bun.FFI` function with the same `name` and throws the error that function returns.
// A signature is read through `args` (own, an array of type numbers or strings), `threadsafe`, `returns` and `ptr`.
// Nothing is retained, and no error message formats a value.
const signatureFields = table.named("args", "threadsafe", "returns", "ptr");
const signature = [table.runsTransitively("OwnValues", "ToPrimitive", signatureFields)];
const signaturesByName = [table.runsTransitively("OwnKeys", "OwnValues", "ToPrimitive", signatureFields)];
const newLibrary = b.any.returning(table.instance("FFI").fresh.spec);
const readsSignatures = {
  ...method,
  runsOnlyOperandCode: true,
  reads: ["ExternalState"],
  writes: ["ExternalState"],
} as const;

export const openLibrary = b.fn({
  ...readsSignatures,
  name: "dlopen",
  length: 1,
  args: { name: b.string.loose.utf8.nullable, symbols: b.any },
  returns: newLibrary,
  uses: { symbols: signaturesByName },
});
export const linkLibrary = b.fn({
  ...readsSignatures,
  name: "linkSymbols",
  length: 1,
  args: { symbols: b.any },
  returns: newLibrary,
  uses: { symbols: signaturesByName },
});
export const makeFunction = b.fn({
  ...readsSignatures,
  name: "cfunction",
  length: 1,
  args: { options: b.any, name: b.string.allowStringObject.otherAsNull },
  uses: { options: signature },
});
/** Native code calls the function with primitives only and converts its result to the declared return type. */
export const makeCallback = b.fn({
  ...readsSignatures,
  name: "callback",
  length: 1,
  args: { options: b.any, callback: b.any },
  uses: {
    options: signature,
    callback: [
      table.retained,
      table.called({
        afterwards: "TouchesOnlyWhatRowNames",
        times: "PerEvent",
        this: table.undefined,
        args: [],
        spreadArgs: table.union(table.f64, table.bigint, table.bool, table.string, table.strictNull, table.undefined),
        result: "Escapes",
      }),
    ],
  },
});
export const printSource = b.fn({
  ...readsSignatures,
  name: "viewSource",
  length: 1,
  args: { symbols: b.any, isCallback: b.bool.loose },
  returns: b.any.returning("string", table.instance("Array").holding({ element: table.string }).fresh.spec),
  uses: { symbols: signaturesByName },
});

export const cc = b.fn({ ...method, args: { options: b.any }, returns: FFI });
