import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::code_resolver_testing" });

/** Each answers JSON, or `undefined` in a Bun without the compiler. A list is one string, a line for each of its parts. */
const answersJSON = { returns: b.string.utf8.optional, capability: "js", throws: true } as const;
const text = b.string.loose.utf8;

export const describeCodeGraph = b.fn({
  args: {
    entryPoints: text,
    conditions: text,
    threads: b.i32,
    defines: text,
    features: text,
    workingDirectory: text,
  },
  ...answersJSON,
});

export const resolveComputedSpecifier = b.fn({
  args: { importer: text, prefix: text, suffix: text, kind: text },
  ...answersJSON,
});
