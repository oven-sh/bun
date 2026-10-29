const key = "prototype";
class Base {}
function filler() {
  return { a: 1 };
}
const held = [class extends Base { static [key]() {} }, filler()];
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
