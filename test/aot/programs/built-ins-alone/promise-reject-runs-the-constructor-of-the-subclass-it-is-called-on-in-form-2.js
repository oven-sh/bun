let calls = 0;
class Special extends Promise {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.reject("an");
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(typeof reason, reason.length, reason);
console.log(result instanceof Special, calls);
