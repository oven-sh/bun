// Two loops, one in the other, each with a scope for each turn; the closures of the inner turns read the scope of the outer turn, and one of them is kept and called when both loops have ended.
function deed(n: number): string {
  let out = "";
  let kept: (() => number) | undefined;
  for (let i = 0; i < n; i++) {
    const row = () => i;
    for (let j = 0; j < n; j++) {
      const cell = () => row() * 10 + j;
      out += String(cell()) + " ";
      if (i === 1 && j === 2) kept = cell;
    }
  }
  return out + "| " + String(kept ? kept() : "none");
}
console.log(deed(2));
console.log(deed(4));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed(3);
console.log(last);
