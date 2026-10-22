let calls = 0;
class Special extends Promise {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.withResolvers();
console.log(typeof result, Object.keys(result).join(), typeof result.resolve, result.resolve.length);
console.log(typeof result.reject, result.reject.length, result.promise instanceof Promise);
console.log(result instanceof Special, calls);
