function run(n: number, k: number): number {
  let x = 3;
  for (let i = 0; i < n; i++) {
    x = (x * 5 + 1) % 29;
    if (k & 1) x = (x + 1) % 29; if (k & 2) x = (x + 2) % 29; if (k & 4) x = (x + 3) % 29; if (k & 8) x = (x + 4) % 29; if (k & 16) x = (x + 5) % 29;
    if (k & 32) x = (x + 6) % 29; if (k & 64) x = (x + 7) % 29; if (k & 128) x = (x + 8) % 29; if (k & 256) x = (x + 9) % 29; if (k & 512) x = (x + 10) % 29;
  }
  return x;
}
console.log(run(1, 0), run(2, 0), run(1, 1023), run(2, 1023), run(1, 512), run(0, 7));
