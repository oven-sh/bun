class Box { n: any; m: any; declare extra: any; constructor() { this.n = 0; this.m = 7; } get length() { this.n = this.n + 1; return this.n; } }
function run(rows: any, times: any, key: any, index: any, field: any, other: any, list: any): string {
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const c: any = new Box();
    let total = 0;
    for (const j of list) { total = total + c.length; }
    out.push(total + "/" + c.n + "/" + c.m + "/" + Object.keys(c).join("+"));
  }
  return out.join(" ");
}
const [rows, times, key, index, field, other, list] = JSON.parse('[2, 4, "count", 0, "n", "m", [0, 1, 2, 3]]');
let said = "";
for (let turn = 0; turn < 300; turn++) said = run(rows | 0, times | 0, key, index, field, other, list);
console.log(said);
