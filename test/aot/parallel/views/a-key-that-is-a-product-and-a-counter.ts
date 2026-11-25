declare const process: { readonly argv: readonly string[] };
const N: number = JSON.parse(process.argv.length > 9 ? "5" : "4");
const grid = new Float64Array(64);
for (let i = 0; i < 64; i++) grid[i] = i / 4 + 1;
function factorThatNoTurnWrites(rows: number, cols: number, limit: number): number {
  let sum = 0;
  for (let i = 0; i < rows; i++) for (let j = 0; j < limit; j++) sum += grid[i * cols + j] ?? -1000;
  return sum;
}
function factorThatTurnsWrite(rows: number, cols: number, limit: number): number {
  let sum = 0;
  let width = cols;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < limit; j++) {
      sum += grid[i * width + j] ?? -1000;
      if (j === 1) width = width === cols ? 1 : cols;
    }
  return sum;
}
for (const cols of [N, -N, N / 8, -0 * N, N * 2 ** 30, N / 0 - N / 0, N])
  console.log(factorThatNoTurnWrites(N, cols, N), factorThatTurnsWrite(N, cols, N));
export {};
