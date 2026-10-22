const result = Promise.reject("text");
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(typeof reason, reason.length, reason);
