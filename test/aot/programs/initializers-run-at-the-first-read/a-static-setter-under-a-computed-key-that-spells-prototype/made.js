const key = "prototype";
const held = [
  class {
    static set [key](value) {}
  },
  new Map([[1, 2]]),
];
function read() {
  return held;
}
if (process.argv.length > 5) console.log(read());
console.log("reached");
