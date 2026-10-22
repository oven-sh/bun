const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.formData();
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof Error, reason.message);
