function filler() {
  return { a: 1 };
}
const held = [class { static get ["prototype"]() { return 1; } }, filler()];
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
