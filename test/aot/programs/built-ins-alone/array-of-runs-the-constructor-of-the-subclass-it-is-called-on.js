let calls = 0;
class Special extends Array {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.of(1.5, "an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1].length, result[1]);
console.log(result instanceof Special, calls);
