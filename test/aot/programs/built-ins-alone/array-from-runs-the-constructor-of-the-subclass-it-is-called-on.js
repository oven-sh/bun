let calls = 0;
const first = new Uint8Array([1, 2, 3]);
class Special extends Array {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.from(first);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, typeof result[2], result[2] + 1);
console.log(result instanceof Special, calls);
