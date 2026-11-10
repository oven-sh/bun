const bound = 2 ** 32;
const kinds = [Float64Array, BigInt64Array, BigUint64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray];
for (const kind of kinds) {
  try {
    const view = new kind(bound / kind.BYTES_PER_ELEMENT + 1);
    console.log(kind.name, "made", view.length);
  } catch (error) {
    console.log(kind.name, (error as Error).name);
  }
}
for (const make of [() => new ArrayBuffer(bound + 1), () => new ArrayBuffer(8, { maxByteLength: bound + 1 }), () => new SharedArrayBuffer(bound + 1)]) {
  try {
    console.log("made", make().byteLength);
  } catch (error) {
    console.log((error as Error).name);
  }
}
