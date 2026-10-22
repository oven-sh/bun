const result = Array.fromAsync("text", "text", "text");
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof TypeError, reason.message);
