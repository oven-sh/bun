// `for await` asks the stream for Symbol.asyncIterator, which holds the function that `values` holds: each of the two can be laid over alone.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
let hits = 0;
const made = () =>
  known({
    start(controller) {
      controller.enqueue("1");
      controller.close();
    },
  });
async function all(stream) {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}
const before = await all(made());
const above = Object.getPrototypeOf(made());
above.values = function () {
  hits += 100;
  return [][Symbol.iterator]();
};
const behindValues = await all(made());
above[Symbol.asyncIterator] = async function* () {
  hits += 1;
  yield "own";
};
console.log(before, behindValues, await all(made()), hits);
