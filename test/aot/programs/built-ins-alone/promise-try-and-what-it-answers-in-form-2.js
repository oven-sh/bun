const result = Promise.try("an", 2.5, "-");
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof TypeError, reason.message);
