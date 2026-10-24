import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::json5_object" });

/** As `JSON.stringify` takes it: a number or a string, which an object may box. Anything else is no indentation. */
export const StringifySpace = b.union({
  number: b.f64,
  text: b.string,
  numberObject: b.cell("JSC::NumberObject", "JavaScriptCore/NumberObject.h", { rustPath: "bun_jsc::JSObject" }),
  stringObject: b.stringObject,
  other: b.ignored,
});

export const JSON5 = b.namespace({
  parse: {
    args: {
      input: b.bytes({
        from: ["string", "buffer", "blob"],
        otherwise: "toString",
        refuse: ["undefined", "null"],
      }),
    },
    returns: b.opaque,
    capability: "heap",
    throws: true,
  },
  stringify: {
    args: { value: b.opaque, replacer: b.opaque.nullable, space: StringifySpace },
    length: 3,
    returns: b.string.local.optional,
    capability: "js",
    throws: true,
  },
});
