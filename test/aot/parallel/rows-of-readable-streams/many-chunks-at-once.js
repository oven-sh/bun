// readMany() answers { value, size, done } at once where chunks wait, and a promise of one where none does.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
const crate = { weight: 1 };
let push;
const stream = known({
  start(controller) {
    controller.enqueue(crate);
    controller.enqueue("text");
    push = chunk => controller.enqueue(chunk);
  },
});
const reader = stream.getReader();
const now = reader.readMany();
const later = reader.readMany();
push(7);
const then = await later;
console.log(Object.keys(now).join(), Array.isArray(now.value), now.value[0] === crate, now.value[1], now.size, now.done);
console.log(later instanceof Promise, Object.keys(then).join(), then.value.join(), then.done);
