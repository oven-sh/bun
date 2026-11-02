const list = [[1, 2]];
list.push(7);
const held = new Map(list);
function read() {
  return held;
}
if (process.argv.length > 5) console.log(read());
console.log("reached");
