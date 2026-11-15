class Mark { constructor(row) { this.left = row.left; this.top = row.top; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } }
let depth = 0;
const kept = [];
const inner = { left: 10.5, top: 11, reach: 12 };
const row = { left: 1.5, get top() { if (depth++ < 1) { kept.push(new Round(row), new Round(inner)); if (kept.length > 40) kept.length = 0; Bun.gc(true); } depth--; return kept.length; }, reach: 3 };
const said = [];
for (let turn = 0; turn < 12; turn++) {
  const made = new Round(row);
  said.push(made.left + made.top + made.reach, kept.map(one => one.left + one.top + one.reach).reduce((sum, one) => sum + one, 0));
}
console.log(said.join(" "));
