// A counted loop pushes one number per turn. One list keeps them all, the other is emptied every 256 turns, so it never needs room for more than that.
function kept(turns: number): number {
  const list: number[] = [];
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    list.push(i & 1023);
    if ((list.length & 255) === 0) sum = (sum + list[i & 255]!) | 0;
  }
  return sum;
}
function emptied(turns: number): number {
  const list: number[] = [];
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    list.push(i & 1023);
    if (list.length === 256) {
      sum = (sum + list[i & 255]!) | 0;
      list.length = 0;
    }
  }
  return sum;
}
const [loop = "emptied every 256 turns", turns = "5000"] = process.argv.slice(2);
console.log(kept(5000), emptied(5000), (loop === "emptied every 256 turns" ? emptied : kept)(Number(turns)));
export {};
