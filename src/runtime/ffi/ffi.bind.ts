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

const method = { returns: b.opaque, feature: "Ffi", capability: "js", throws: true } as const;

// The functions of `Bun.FFI`. One that is given bad options returns the error.
export const viewSource = b.fn({
  ...method,
  export: "Bun__FFI__viewSource",
  args: { symbols: b.opaque, isCallback: b.bool.loose },
});
/** Without a `name` it throws. */
export const dlopen = b.fn({
  ...method,
  export: "Bun__FFI__dlopen",
  args: { name: b.string.loose.utf8.nullable, symbols: b.opaque },
});
export const callback = b.fn({
  ...method,
  export: "Bun__FFI__callback",
  args: { options: b.opaque, callback: b.opaque },
});
export const linkSymbols = b.fn({ ...method, export: "Bun__FFI__linkSymbols", args: { symbols: b.opaque } });
/** A callback that is closed has no address any more. */
export const closeCallback = b.fn({
  export: "Bun__FFI__closeCallback",
  feature: "Ffi",
  args: { callback: b.opaque },
  uses: { callback: [...table.handedOver, table.definesName(["ptr"], table.strictNull)] },
});
export const cfunction = b.fn({
  ...method,
  export: "Bun__FFI__cfunction",
  args: { options: b.opaque, name: b.string.allowStringObject.otherAsNull },
});

export const cc = b.fn({ ...method, args: { options: b.opaque }, returns: FFI });
