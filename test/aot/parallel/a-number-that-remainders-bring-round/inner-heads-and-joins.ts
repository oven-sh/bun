function run(n: number, m: number): string {
  let x = 1, y = 2;
  for (let i = 0; i < n; i++) {
    switch (i & 3) { case 0: x = (x * 5 + 3) % 11; break; case 1: y = x; x = 4; break; case 2: x = y % 3; break; default: y = (x + y) % 7; }
    for (let j = 0; j < m; j++) { if (j === 1) continue; x = (x + j + 2) % 13; if (x === 0) break; }
  }
  return x + " " + y;
}
console.log(run(0, 0), "|", run(4, 0), "|", run(4, 3), "|", run(5, 1));
