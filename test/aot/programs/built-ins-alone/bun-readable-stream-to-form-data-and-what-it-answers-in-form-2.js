const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = Bun.readableStreamToFormData(first, "-");
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof Error, reason.message, first instanceof ReadableStream, Object.keys(first).join());
