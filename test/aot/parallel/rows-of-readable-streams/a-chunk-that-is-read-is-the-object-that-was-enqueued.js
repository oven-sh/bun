// read() hands out the very object that the source enqueued: what is stored on one is seen through the other.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
const crate = { weight: 1 };
const stream = known({
  start(controller) {
    controller.enqueue(crate);
    controller.close();
  },
});
const reader = stream.getReader();
const first = await reader.read();
first.value.weight += 41;
const second = await reader.read();
console.log(first.value === crate, crate.weight, first.done, Object.keys(first).join(), second.value, second.done);
