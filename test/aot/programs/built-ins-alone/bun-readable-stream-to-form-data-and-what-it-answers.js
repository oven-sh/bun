const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = Bun.readableStreamToFormData(first, 2.5);
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof TypeError, reason.message, first instanceof ReadableStream, Object.keys(first).join());
