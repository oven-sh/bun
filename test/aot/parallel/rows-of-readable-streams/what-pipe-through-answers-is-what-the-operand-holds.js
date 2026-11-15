// pipeThrough() reads `readable` and `writable` of its operand, getters too, and answers the very stream that `readable` gave.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
const order = [];
const shout = new TransformStream({
  transform(chunk, controller) {
    controller.enqueue(chunk.toUpperCase());
  },
});
const pair = {
  get readable() {
    order.push("readable");
    return shout.readable;
  },
  get writable() {
    order.push("writable");
    return shout.writable;
  },
};
const options = {
  get preventAbort() {
    order.push("preventAbort");
    return false;
  },
  get preventCancel() {
    order.push("preventCancel");
    return false;
  },
  get preventClose() {
    order.push("preventClose");
    return false;
  },
  get signal() {
    order.push("signal");
    return undefined;
  },
};
const source = known({
  start(controller) {
    controller.enqueue("made");
    controller.enqueue("up");
    controller.close();
  },
});
const answered = source.pipeThrough(pair, options);
let text = "";
for await (const chunk of answered) text += chunk;
console.log(answered === shout.readable, order.join(), text, source.locked);
