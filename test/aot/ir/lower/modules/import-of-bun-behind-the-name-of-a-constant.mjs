// OPTIONS: builtin-modules

// RUN(WRITTEN): lower
// WRITTEN-LABEL: function {{*}}name="written"
// WRITTEN-NOT: = Import
// WRITTEN: Return

// RUN(NAMED): lower
// NAMED-LABEL: function {{*}}name="named"
// NAMED-NOT: = Import
// NAMED: Return

// `Bun` stands in place of `import("bun")` where the name is written out, and behind the name of a constant too: `bun run` prints "bun" in place of `first`, and so has `Bun` there.
const first = "bun";

export function written() {
  return import("bun");
}

export function named() {
  return import(first);
}
