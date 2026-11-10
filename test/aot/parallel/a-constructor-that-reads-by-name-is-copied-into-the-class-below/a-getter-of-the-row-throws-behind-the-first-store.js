class Mark { constructor(row) { this.left = row.left; this.top = row.top; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } }
let turn = 0;
const plain = { left: 1.5, top: 2, reach: 3 };
const hostile = { left: 4, get top() { if (turn >= 5) throw new RangeError("top at " + turn); return 5; }, reach: 6 };
const said = [];
for (turn = 0; turn < 12; turn++) {
  for (const row of [plain, hostile]) {
    try { const made = new Round(row); said.push(made.left + made.top + made.reach, Object.keys(made).join()); }
    catch (error) { said.push(error.name + " " + error.message); }
  }
}
console.log(said.join(" | "));
