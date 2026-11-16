// `for await` calls `next` of the iterator that values() made, and `return` where the loop is left: the program's own where it laid one.
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
const above = Object.getPrototypeOf(made().values());
const next = above.next;
above.next = function () {
  hits += 1;
  return next.call(this);
};
above.return = function (value) {
  hits += 10;
  return Promise.resolve({ value, done: true });
};
let text = "";
for await (const chunk of made()) text += chunk;
for await (const chunk of made()) break;
console.log(text, hits);
