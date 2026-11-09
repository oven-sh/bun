// What the light streams that a compiled program may have in place of process.stdout, process.stderr and process.stdin (builtins/stdio.ts) serve.
export default {
  // WHAT A LIGHT STREAM SERVES BY ITSELF. Its `get` trap asks these lists first, and the compiler keeps the whole stream out of a program that asks a stream for nothing else:
  // src/codegen/builtins/host/runtime-dependencies.builtins.ts reads them. A name that stands here and that no line of the trap answers, or the other way round, stops the program that asks for it.
  // What a method's name answers looks at its receiver, so the compiler lets it be called on the stream and do nothing else.
  servedByLightOutputs: { values: ["isTTY", "fd", "columns", "rows"], methods: ["write", "getColorDepth"] },
  servedByLightInput: { values: ["isTTY", "fd"], methods: [] as string[] },
};
