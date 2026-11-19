export default [
  // class list for $inherits*() builtins, eg. $inheritsBlob()
  // tests if a value is an instanceof a native class in a robust cross-realm manner
  // the index is the id jsFunctionInherits in ZigGlobalObject.cpp switches on
  "Blob",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "ArrayBuffer",
];
