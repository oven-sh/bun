let calls = 0;
class Special extends ArrayBuffer {
  static count = 0;
  static get [Symbol.species]() {
    calls++;
    this.count++;
    console.log("Symbol.species", this === Special);
    return ArrayBuffer;
  }
}
const special = new Special(8, { maxByteLength: 16 });
console.log("made");
const result = special.slice(1, 2);
console.log(result instanceof ArrayBuffer, result.byteLength);
console.log(calls, Special.count);
