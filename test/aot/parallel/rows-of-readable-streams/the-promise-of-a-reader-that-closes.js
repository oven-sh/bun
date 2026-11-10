// `closed` answers the same promise at every read, and another one behind releaseLock().
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
let close;
const stream = known({
  start(controller) {
    close = () => controller.close();
  },
});
const reader = stream.getReader();
const first = reader.closed;
const same = reader.closed === first;
close();
const settled = await first;
console.log(reader.releaseLock(), stream.locked);
const second = reader.closed;
const failed = await second.then(
  () => "settled",
  error => `${error.code}`,
);
const off = await Object.getOwnPropertyDescriptor(ReadableStreamDefaultReader.prototype, "closed")
  .get.call({})
  .then(
    () => "settled",
    error => error.name,
  );
console.log(same, settled, second === first, failed, off);
