const key = "prototype";
function filler() {
  return { a: 1 };
}
const held = [class { static *[key]() {} }, filler()];
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
