// What is printed is what plain Bun prints.
function never() {
  const inner = Object.create(Array.prototype); inner.length = 1000000;
  const outer = Object.create(Array.prototype); outer.length = 3000;
  for (let i = 0; i < 3000; i++) outer[i] = inner;
  return outer.join();
}
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
