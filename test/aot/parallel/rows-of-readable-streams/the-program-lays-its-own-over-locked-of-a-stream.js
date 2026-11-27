// The program lays its own over `locked`: behind that every use finds what the program laid there.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
let hits = 0;
const own = { laid: "by the program" };
const made = () =>
  known({
    start(controller) {
      controller.enqueue("1");
      controller.close();
    },
  });
function ask() {
  return made().locked;
}
const before = ask();
const above = Object.getPrototypeOf(made());
Object.defineProperty(above, "locked", {
  get() {
    hits += 1;
    return own;
  },
});
let found = 0;
for (let turn = 0; turn < 50; turn++) {
  if (ask() === own) found += 1;
}
console.log(before === own, hits, found);
