// A read by position of an object of one layout, in a loop. What it finds lies in the object's extra properties, in other storage than usual, or up the chain.
enum Color {
  Red,
  Green,
  Blue,
}
const values: Color[] = [Color.Red, Color.Green, Color.Blue, Color.Red];
function nameOf(i: number): number {
  return Color[values[i & 3]].length;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += nameOf(i);
console.log(sum);

const positions: (number | undefined)[] = [0, 1, 2, 3, -1, 1.5, 4294967296, undefined, NaN];
function readAll(table: { [position: number]: unknown; tag: number }, loops: number) {
  const out: unknown[] = [];
  for (let turn = 0; turn < loops; turn++) {
    out.length = 0;
    for (const position of positions) out.push(table[position as number]);
  }
  return out;
}
console.log(readAll({ tag: 1 }, 50));

const holes: { [position: number]: unknown; tag: number } = { tag: 2 };
holes[0] = "first";
holes[2] = "third";
holes[-1] = "negative";
holes[1.5] = "fraction";
console.log(readAll(holes, 50));

const doubles: { [position: number]: unknown; tag: number } = { tag: 3 };
doubles[0] = 1.5;
doubles[1] = 2.5;
console.log(readAll(doubles, 50));

const integers: { [position: number]: unknown; tag: number } = { tag: 4 };
integers[0] = 1;
integers[1] = 2;
console.log(readAll(integers, 50));

const sparse: { [position: number]: unknown; tag: number } = { tag: 5 };
sparse[1000000] = "far";
sparse[1] = "near";
console.log(readAll(sparse, 50));

let reads = 0;
const accessed: { [position: number]: unknown; tag: number } = { tag: 6 };
accessed[0] = "plain";
Object.defineProperty(accessed, 1, {
  get() {
    reads++;
    return "from a getter";
  },
});
console.log(readAll(accessed, 50), reads);

const frozen: { [position: number]: unknown; tag: number } = { tag: 7 };
frozen[0] = "kept";
Object.freeze(frozen);
console.log(readAll(frozen, 50));

const deleted: { [position: number]: unknown; tag: number } = { tag: 8 };
deleted[0] = "gone";
deleted[1] = "stays";
delete deleted[0];
console.log(readAll(deleted, 50));

const inheriting: { [position: number]: unknown; tag: number } = Object.create(["from the prototype", "second"]);
inheriting.tag = 9;
inheriting[1] = "own";
console.log(readAll(inheriting, 50));

function rename(i: number) {
  const names: { [position: number]: string; tag: number } = { tag: 10 };
  names[i & 1] = "made";
  let found = "";
  for (let turn = 0; turn < 3; turn++) found += names[turn & 1] ?? "-";
  return found;
}
let renamed = "";
for (let i = 0; i < 4; i++) renamed += rename(i) + " ";
console.log(renamed);
