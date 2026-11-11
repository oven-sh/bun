let worked = 0;
class Page {
  kept: any;
  words: any;
  constructor(words: any) { this.kept = undefined; this.words = words; }
  get length() { return this.kept ??= (worked = worked + 1, this.words * 2); }
}
function run(rows: any, times: any): string {
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const c = new Page(i + 1);
    let total = 0;
    for (let j = 0; j < times; j++) total = total + c.length;
    out.push(total + "/" + c.kept + "/" + worked);
  }
  return out.join(" ");
}
const [rows, times] = JSON.parse("[2, 4]");
let said = "";
for (let turn = 0; turn < 300; turn++) { worked = 0; said = run(rows | 0, times | 0); }
console.log(said);
