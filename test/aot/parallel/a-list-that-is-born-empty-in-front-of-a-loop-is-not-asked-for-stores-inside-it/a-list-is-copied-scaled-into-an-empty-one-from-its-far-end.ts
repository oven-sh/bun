// STATISTIC: LoopsBuiltTwice >= 1
const rounds = Number(process.argv[2] ?? 3);
function scaled(source: any, by: number): any {
  const count = source.length;
  const cells = [];
  for (let i = count - 1; i >= 0; --i) cells[i] = source[i] * by;
  return cells;
}
const sources: any[] = JSON.parse('[[0.5,1.5,2.5,3.5,4.5],[],[7],[1,2,3],[0.5,null,2.5]]');
sources[4][1] = undefined;
for (let r = 0; r < rounds; r++) {
  for (const source of sources) {
    const cells = scaled(source, 2 + (r & 1));
    console.log(cells.length, cells.join());
  }
  console.log(scaled("12", 3).join(), scaled({ length: 2, 0: 4, 1: 5 }, 2).join(), Object.keys(scaled({ length: 1.5, 0: 3 }, 2)).join());
}
