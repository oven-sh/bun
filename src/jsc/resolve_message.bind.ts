import * as b from "../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const cached = { getter: b.any, cache: true, ...js } as const;
const text = { getter: b.string.utf8, cache: true } as const;

/** Error.prototype in the chain: userland checks `err instanceof Error`. */
const errorClass = { construct: "illegal", prototypeBase: "Error" } as const;
const methods = {
  toJSON: { returns: b.any, ...js },
  toString: { returns: b.any, ...js },
  "@@toPrimitive": { args: { hint: b.any }, returns: b.any, ...js },
} as const;

export const ResolveMessage = b.class({
  ...errorClass,
  rustPath: "crate::ResolveMessage",
  proto: {
    code: cached,
    column: { getter: b.i32 },
    importKind: cached,
    level: cached,
    line: { getter: b.i32 },
    message: { ...text, writable: true },
    position: cached,
    referrer: text,
    requireStack: { getter: b.array(b.string.utf8).optional, cache: true },
    specifier: text,
    stack: { ...text, writable: true },
    ...methods,
  },
});

export const BuildMessage = b.class({
  ...errorClass,
  rustPath: "crate::BuildMessage",
  proto: {
    column: { getter: b.i32 },
    level: cached,
    line: { getter: b.i32 },
    message: { ...text, writable: true },
    notes: cached,
    position: cached,
    ...methods,
  },
});
