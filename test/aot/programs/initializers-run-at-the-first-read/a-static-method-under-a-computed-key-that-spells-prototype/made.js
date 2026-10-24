const key = ["proto", "type"].join("");
const held = [
  class {
    static [key]() {}
  },
  new Map([[1, 2]]),
];
function read() {
  return held;
}
if (process.argv.length > 5) console.log(read());
console.log("reached");
