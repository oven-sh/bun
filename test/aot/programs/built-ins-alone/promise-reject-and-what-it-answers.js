const result = Promise.reject(1.5);
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(typeof reason, reason + 1);
