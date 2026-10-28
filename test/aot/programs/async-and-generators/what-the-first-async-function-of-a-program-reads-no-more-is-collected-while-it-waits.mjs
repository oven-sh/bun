// What the first async function of a program made and reads no more is collected while the function waits. It has run to its end twice before.
let last;
let asking = false;
let sink = 0;
let overwritten = 1;
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
// A collection reads the stack word by word, and the frames of the event loop that calls the program again lie where earlier calls have left theirs.
function overwriteStack(depth, a) {
  if (depth === 0) return a;
  const b = a + 1;
  const c = b * 2;
  const d = c - a;
  const e = d + b;
  const f = e * 3;
  const g = f - c;
  const h = g + d;
  const i = h * 5;
  const j = i - e;
  const k = j + f;
  const l = k * 7;
  const m = l - g;
  return (overwriteStack(depth - 1, m % 1000) + b + c + d + e + f + g + h + i + j + k + l) % 1000;
}
async function pause(label) {
  if (!asking) return 1;
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
  }
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  return 1;
}
async function fillsMap(n) {
  const holder = new Map([[n, make(n)]]);
  sink += holder.size;
  switch (n & 1) {
    case 0:
      await pause("a map made of a list");
      break;
    default:
      await pause("a map made of a list");
  }
  return 1;
}
for (let n = 0; n < 2; n++) await fillsMap(n);
asking = true;
const waiting = fillsMap(2);
overwritten = overwriteStack(200, overwritten);
await waiting;
console.log("sum", sink, typeof overwritten);
