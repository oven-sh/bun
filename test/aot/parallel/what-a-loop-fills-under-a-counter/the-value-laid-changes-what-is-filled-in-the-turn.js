const at = JSON.parse("0");
const held = [];
function lay(value) {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = value;
}
function fill(holders, value) {
  held[0] = holders[0];
  lay(value);
  return holders[0];
}
const said = [];
const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
const tracking = new Uint8Array(buffer);
let calls = 0;
fill([tracking], {
  valueOf() {
    calls++;
    if (calls === 2) buffer.resize(3);
    if (calls === 5) buffer.resize(12);
    return calls;
  },
});
said.push(`${tracking.length} ${tracking.join()}`);
const moved = new ArrayBuffer(8);
const left = new Float64Array(moved, 0, 1);
const bytes = new Int16Array(moved);
calls = 0;
fill([bytes], {
  valueOf() {
    calls++;
    if (calls === 3) moved.transfer();
    return calls;
  },
});
said.push(`${bytes.length} ${left.length} ${calls}`);
const own = [1, 2, 3];
said.push(fill([own], own).map(each => (each === own ? "own" : each)).join());
const sparse = [];
sparse[100000] = 1;
said.push(`${fill([sparse], 2).length} ${sparse.slice(0, 7).join()}`);
const short = [1.5];
short.length = 0;
said.push(`${fill([short], 2.5).length} ${short.join()}`);
said.push(fill([new Int16Array(3)], "12").join());
console.log(
  said.join(`
`),
);
