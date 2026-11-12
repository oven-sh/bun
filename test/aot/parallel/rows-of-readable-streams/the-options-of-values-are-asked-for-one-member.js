// values(options) reads `preventCancel`, a getter too, and leaving the loop cancels the stream or does not.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
let asked = 0;
let cancelled = 0;
function made() {
  return known({
    start(controller) {
      controller.enqueue(1);
      controller.enqueue(2);
    },
    cancel() {
      cancelled += 1;
    },
  });
}
const kept = made();
for await (const chunk of kept.values({
  get preventCancel() {
    asked += 1;
    return true;
  },
})) {
  if (chunk === 1) break;
}
const afterKept = cancelled;
for await (const chunk of made()) {
  if (chunk === 1) break;
}
let refused = "";
try {
  made().values(7);
} catch (error) {
  refused = `${error.name}: ${error.message}`;
}
console.log(asked, afterKept, cancelled, kept.locked, (await kept.getReader().read()).value, refused);
