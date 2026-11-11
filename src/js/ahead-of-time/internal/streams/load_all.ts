// A module of compiled programs alone: `bun run` has no text under this name and never loads it.
// test/internal/second-texts-of-modules.test.ts holds that no text outside this folder asks for it.

// Making process.stdout or process.stderr loads all of node:stream, which adds members to what its parts define. The light streams that a compiled program may have
// in their place (builtins/stdio.ts) load none of it: where a part is loaded already, they ask here for the rest.
export default {
  /** Stored by the first part that is loaded. */
  rest: undefined as undefined | (() => void),
  // WHAT A LIGHT STREAM SERVES BY ITSELF. Its `get` trap asks these lists first, and the compiler keeps the whole stream out of a program that asks a stream for nothing else:
  // src/codegen/builtins/host/runtime-dependencies.builtins.ts reads them. A name that stands here and that no line of the trap answers, or the other way round, stops the program that asks for it.
  // What a method's name answers looks at its receiver, so the compiler lets it be called on the stream and do nothing else.
  servedByLightOutputs: { values: ["isTTY", "fd", "columns", "rows"], methods: ["write", "getColorDepth"] },
  servedByLightInput: { values: ["isTTY", "fd"], methods: [] as string[] },
};
