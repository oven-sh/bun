import * as b from "../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const text = { getter: b.string.utf8, cache: true } as const;
const label = { getter: b.string.local, cache: true, ...js } as const;
const position = { getter: b.opaque.returning("object", "null"), cache: true, ...js } as const;
const coordinate = { getter: b.i32, pure: true } as const;

/** Error.prototype in the chain: userland checks `err instanceof Error`. */
const errorClass = { construct: "illegal", prototypeBase: "Error" } as const;
const methods = {
  toJSON: { returns: b.object, ...js },
  toString: { returns: b.string.local, ...js },
  "@@toPrimitive": {
    args: { hint: b.string.allowStringObject.otherAsNull },
    returns: b.string.local.nullable,
    length: 1,
    ...js,
  },
} as const;

export const ResolveMessageCode = b.enumeration([
  "ERR_UNKNOWN_BUILTIN_MODULE",
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
  "RESOLVE_ERROR",
]);

export const ResolveMessage = b.class({
  ...errorClass,
  rustPath: "crate::ResolveMessage",
  proto: {
    code: { getter: ResolveMessageCode.optional, cache: true },
    column: coordinate,
    importKind: label,
    level: label,
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
    level: label,
    line: coordinate,
    message: { ...text, writable: true },
    notes: { getter: b.jsArray, cache: true, ...js },
    position,
    ...methods,
  },
});
