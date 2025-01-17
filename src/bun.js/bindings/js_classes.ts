export default [
  // class list for $inherits*() builtins, eg. $inheritsBlob()
  // tests if a value is an instanceof a native class in a robust cross-realm manner
  ["Blob"],
  ["ReadableStream", "JSReadableStream.h"],
  ["WritableStream", "JSWritableStream.h"],
  ["TransformStream", "JSTransformStream.h"],
];
