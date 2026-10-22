const subject = new Blob([]);
const result = subject.json();
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof SyntaxError, reason.message);
