const pair = [1, 2];
Object.defineProperty(pair, 0, {
  get() {
    throw new RangeError("the key is read");
  },
});
const held = new Map([pair]);
function read() {
  return held;
}
if (process.argv.length > 5) console.log(read());
console.log("reached");
