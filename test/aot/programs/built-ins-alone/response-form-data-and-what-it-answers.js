const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.formData();
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof TypeError, reason.message);
