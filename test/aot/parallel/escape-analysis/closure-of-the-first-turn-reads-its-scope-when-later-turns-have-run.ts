// Each turn of a loop has a scope of its own that two closures share and that the turn has done with at its end; the reader of the first turn alone is kept, over collections, and reads its own scope when many later turns have stored in theirs.
function deed(n: number): string {
  let first: (() => number) | undefined;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let seen = i * 7 + 1;
    const read = () => seen;
    const bump = () => {
      seen++;
    };
    bump();
    sum += read();
    if (i === 0) first = read;
    if (i === 3) Bun.gc(true);
  }
  return String(sum) + " " + String(first ? first() : "none");
}
console.log(deed(1));
console.log(deed(6));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed(3);
console.log(last);
