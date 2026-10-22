let calls = 0;
class Special extends Uint8Array {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.of(1.5, "an");
console.log(typeof result, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, 1 / result[1]);
console.log(result instanceof Special, calls);
