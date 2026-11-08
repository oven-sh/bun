import * as b from "../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const cached = { getter: b.any, cache: true, ...js } as const;
const text = { getter: b.string.utf8, cache: true } as const;
const level = { ...cached, getter: b.any.returning("string") } as const;
const position = { ...cached, getter: b.any.returning("object", "null") } as const;
const coordinate = { getter: b.i32, pure: true } as const;

/** Error.prototype in the chain: userland checks `err instanceof Error`. */
const errorClass = { construct: "illegal", prototypeBase: "Error" } as const;
const methods = {
  toJSON: { returns: b.any.returning("object"), ...js },
  toString: { returns: b.any.returning("string"), ...js },
  "@@toPrimitive": { args: { hint: b.any }, returns: b.any.returning("string", "null"), ...js },
} as const;

export const ResolveMessage = b.class({
  ...errorClass,
  rustPath: "crate::ResolveMessage",
  proto: {
    code: { ...cached, getter: b.any.returning("string", "undefined") },
    column: coordinate,
    importKind: { ...cached, getter: b.any.returning("string") },
    level,
    line: coordinate,
    message: { ...text, writable: true },
    position,
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
    column: coordinate,
    level,
    line: coordinate,
    message: { ...text, writable: true },
    notes: { ...cached, getter: b.any.returning("Array") },
    position,
    ...methods,
  },
});
