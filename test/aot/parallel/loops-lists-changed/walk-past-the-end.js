// Loops whose counter goes on past the end of what it indexes. Behind the end a read answers undefined and a store does nothing.
function read(view, from, to) {
  let missing = 0, sum = 0;
  for (let i = from; i < to; i++) {
    const value = view[i];
    if (value === undefined) missing++;
    else sum = (sum + value) | 0;
  }
  return sum + ":" + missing;
}
function readAhead(view, from, to) {
  let missing = 0, sum = 0;
  for (let i = from; i < to; i++) {
    const value = view[i + 2];
    if (value === undefined) missing++;
    else sum = (sum + value) | 0;
  }
  return sum + ":" + missing;
}
function write(view, from, to) {
  for (let i = from; i < to; i++) view[i] = i;
}
const ends = JSON.parse("[0, 8, 31, 32, 33, 40, 64]");
const lines = [];
for (const to of ends) {
  const buffer = new ArrayBuffer(1024);
  new Int32Array(buffer).fill(7);
  const view = new Int32Array(buffer, 0, 32);
  const list = new Array(32).fill(3);
  lines.push(read(view, 0, to), readAhead(view, 0, to), read(list, 0, to), readAhead(list, 0, to));
  write(view, 0, to);
  lines.push(new Int32Array(buffer, 128, 8).join(""));
}
console.log(lines.join(" "));
