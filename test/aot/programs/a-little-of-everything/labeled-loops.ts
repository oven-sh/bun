// break and continue with labels, in nested loops.
const found: number[][] = [];
outer: for (let i = 0; i < 4; i++) {
  inner: for (let j = 0; j < 4; j++) {
    if (j === 2) continue outer;
    if (i === 3) break outer;
    if (i === j) continue inner;
    found.push([i, j]);
  }
}
console.log(found);
let n = 0;
block: {
  n++;
  if (n === 1) break block;
  n = 100;
}
do {
  n += 2;
} while (n < 6);
while (true) {
  if (++n > 8) break;
}
for (const key in { a: 1, b: 2 }) console.log(key);
for (let i = 0, j = 10; i < j; i += 3, j -= 3) console.log(i, j);
console.log(n);
