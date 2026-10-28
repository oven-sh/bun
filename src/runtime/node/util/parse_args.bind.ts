import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::util::parse_args" });

/** `args` is checked before the rest is read, and the rest is read before any of it is checked. */
export const ParseArgsConfig = b.dictionary(
  {
    args: { type: b.opaque, own: true },
    strict: { type: b.opaque.nullable, own: true },
    allowPositionals: { type: b.opaque.nullable, own: true },
    tokens: { type: b.opaque.nullable, own: true },
    allowNegative: { type: b.opaque.nullable, own: true },
    options: { type: b.opaque, own: true },
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
