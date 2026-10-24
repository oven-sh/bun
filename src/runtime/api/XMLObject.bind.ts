import * as b from "../../codegen/bindgen-lib.ts";
import { StringifySpace } from "./JSON5Object.bind.ts";

export default b.module({ rustPath: "crate::api::xml_object" });

/** The error for anything else names what it is. */
export const XMLCompact = b.union({ missing: b.undefined, flag: b.bool, other: b.opaque });
export const XMLParseOptions = b.dictionary({ compact: XMLCompact }, { allowArray: true, reportedAs: "options" });
export const XMLReviverOrOptions = b.union({ reviver: b.callable, options: XMLParseOptions });

export const XML = b.namespace({
  parse: {
    args: {
      /** A string is parsed in its own encoding, and not as UTF-8. */
      input: b.bytes({
        from: ["string", "buffer", "blob"],
        otherwise: "toString",
        refuse: ["undefined", "null"],
        string: "asIs",
        held: "handle",
      }),
      options: XMLReviverOrOptions.nullable,
    },
    expected: { options: "XML.parse options must be an object" },
    returns: b.opaque,
    capability: "js",
    throws: true,
    length: 2,
  },
  stringify: {
    args: { value: b.opaque, replacer: b.opaque.nullable, space: StringifySpace },
    length: 3,
    returns: b.string.local.optional,
    capability: "js",
    throws: true,
  },
});
