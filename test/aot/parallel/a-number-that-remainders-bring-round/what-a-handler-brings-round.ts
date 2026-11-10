function run(n: number, at: number): string {
  let x = 7, caught = 0;
  for (let i = 0; i < n; i++) {
    try { x = (x * 3 + 1) % 16; if (i === at) throw x - 20; x = (x + 5) % 16; } catch (e) { x = e as number; caught++; }
  }
  return x + " " + caught;
}
console.log(run(3, -1), "|", run(3, 1), "|", run(2, 1), "|", run(4, 1));
