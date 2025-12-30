export default [
  // class list for $inherits*() builtins, eg. $inheritsBlob()
  // tests if a value is an instanceof a native class in a robust cross-realm manner
  // source-of-truth impl in src/codegen/generate-classes.ts
  // result in build/debug/codegen/ZigGeneratedClasses.cpp
  ["Blob"],
  ["ReadableStream", "JSReadableStream.h"],
  ["WritableStream", "JSWritableStream.h"],
  ["TransformStream", "JSTransformStream.h"],
  ["ArrayBuffer"],
  ["CompressionStream", "JSCompressionStream.h"],
  ["DecompressionStream", "JSDecompressionStream.h"],
];
