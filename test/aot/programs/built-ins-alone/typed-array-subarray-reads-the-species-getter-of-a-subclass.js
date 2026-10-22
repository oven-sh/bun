let calls = 0;
class Special extends Uint8Array {
  static count = 0;
  static get [Symbol.species]() {
    calls++;
    this.count++;
    console.log("Symbol.species", this === Special);
    return Uint8Array;
  }
}
const special = new Special([1, 2, 3]);
console.log("made");
const result = special.subarray(1, 2);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(calls, Special.count);
