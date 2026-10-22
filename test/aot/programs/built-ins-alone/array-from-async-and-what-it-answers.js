const result = Array.fromAsync(1.5, 2.5, 3.5);
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof TypeError, reason.message);
