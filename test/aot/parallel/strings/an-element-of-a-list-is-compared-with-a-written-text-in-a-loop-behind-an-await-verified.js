// Flags: --aot-check=validate-references
// `words[0] === "blue"` in the condition of a loop of an async generator, behind an await.
const words = ["red", "green", "blue", ""];
class Box {
  u = 0;
}
async function later(x) {
  return (x + 1) | 0;
}
async function* turns(a) {
  const box = new Box();
  const x = await later(a);
  for (let c = 0; c < 4 && (words[0] === "blue" || c < 1); c++) {
    box.u = x >>> 0;
  }
  return box.u;
}
let sum = 0;
for (let i = 0; i < 21; i++) sum = (sum + (await turns(i).next(0)).value) | 0;
console.log(sum);
