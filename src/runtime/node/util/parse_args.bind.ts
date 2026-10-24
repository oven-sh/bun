import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::util::parse_args" });

/** In each union, an error shows `other`. */
export const ParseArgsList = b.union({ missing: b.null, list: b.jsArray, other: b.opaque });
export const ParseArgsFlag = b.union({ missing: b.null, flag: b.bool, other: b.opaque });
/**
 * Each own enumerable string key of `object` is the long name of an option.
 * Its value is `{ type, short?, multiple?, default? }`, own properties only.
 */
export const ParseArgsOptions = b.union({ missing: b.null, object: b.object, other: b.opaque });
/** `args` is checked before the rest is read, and the rest is read before any of it is checked. */
export const ParseArgsConfig = b.dictionary(
  {
    args: { type: ParseArgsList, own: true },
    strict: { type: ParseArgsFlag, own: true },
    allowPositionals: { type: ParseArgsFlag, own: true },
    tokens: { type: ParseArgsFlag, own: true },
    allowNegative: { type: ParseArgsFlag, own: true },
    options: { type: ParseArgsOptions, own: true },
  },
  { deferred: true },
);

/** A primitive but `null` has no property, so it is every default. */
export const ParseArgsArgument = b.union({
  unset: b.undefined,
  null: b.null,
  config: ParseArgsConfig,
  other: b.ignored,
});
/** Returns `{ values, positionals, tokens? }`, which hold elements of `args` and the `default` of options as they are. */
export const parseArgs = b.fn({
  args: { config: ParseArgsArgument },
  returns: b.object,
  capability: "js",
  throws: true,
});
