// `text += part; look(text)`: what is handed on is not put together out of all the parts at each turn.
// The first 512 parts (2,048 where a block has 64 KB) lie as ropes: a step, once. These sizes lie behind it.
// Sizes: 4000 16000 64000
// Passes: 96
// Grows: linear
const size = Number(process.env.SIZE ?? 100),
  passes = Number(process.env.PASSES ?? 1);
let seen = 0;
function look(text: string): void {
  seen = (seen + text.length) | 0;
}
function once(): string {
  let text = "";
  for (let turn = 0; turn < size; turn++) {
    text += turn & 1 ? "│" : "ab";
    look(text);
  }
  return text.length + " " + seen;
}
let told = "";
for (let pass = 0; pass < passes; pass++) {
  seen = 0;
  told = once();
}
console.log(told);
