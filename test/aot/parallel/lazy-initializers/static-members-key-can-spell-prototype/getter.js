const key = "prototype";
function filler() {
  return { a: 1 };
}
const held = [class { static get [key]() { return 1; } }, filler()];
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
