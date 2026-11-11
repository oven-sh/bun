console.log(
  Uint8Array[Symbol.species].from([1, 2, 3]).length,
  Uint8Array[Symbol.species].of(1).length,
  typeof Uint8Array[Symbol.species].fromBase64,
  ArrayBuffer[Symbol.species].isView(new Uint8Array(1)),
  RegExp[Symbol.species].escape("a.b"),
);
