// What the first async function of a program made and reads no more is collected while the function waits. It has run to its end twice before.
let last;
let asking = false;
let sink = 0;
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
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
await fillsMap(2);
console.log("sum", sink);
