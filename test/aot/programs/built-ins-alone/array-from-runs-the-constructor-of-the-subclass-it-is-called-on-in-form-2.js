let calls = 0;
class Special extends Array {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.from(1.5);
console.log(Array.isArray(result), result.length);
console.log(result instanceof Special, calls);
