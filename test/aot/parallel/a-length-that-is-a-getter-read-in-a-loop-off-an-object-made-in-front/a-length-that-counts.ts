class Counter {
  n: any;
  constructor() { this.n = 0; }
  get length() { this.n = this.n + 1; return this.n; }
}
function run(rows: any, times: any): string {
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const c = new Counter();
    let total = 0;
    for (let j = 0; j < times; j++) total = total + c.length;
    out.push(total + "/" + c.n);
  }
  return out.join(" ");
}
const [rows, times] = JSON.parse("[2, 4]");
let said = "";
for (let turn = 0; turn < 300; turn++) said = run(rows | 0, times | 0);
console.log(said);
