// The pull function of the program runs inside read(): a field that it stores to is read again behind the call.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
const tally = { pulls: 0 };
const stream = known(
  {
    pull(controller) {
      tally.pulls += 1;
      controller.enqueue(tally.pulls);
    },
  },
  { highWaterMark: 0 },
);
const reader = stream.getReader();
function step() {
  const before = tally.pulls;
  const pending = reader.read();
  return [before, tally.pulls, pending];
}
let line = "";
for (let turn = 0; turn < 3; turn++) {
  const [before, after, pending] = step();
  line += `${before}>${after}:${(await pending).value} `;
}
console.log(line);
