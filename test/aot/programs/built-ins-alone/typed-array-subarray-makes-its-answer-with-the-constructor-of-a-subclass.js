let calls = 0;
class Special extends Uint8Array {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const special = new Special([1, 2, 3]);
console.log("made");
const result = special.subarray(1, 2);
console.log(typeof result, result.length, typeof result[0], result[0] + 1);
console.log(calls);
