function filler() {
  return { a: 1 };
}
const held = [class { ["prototype"]() {} }, filler()];
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
