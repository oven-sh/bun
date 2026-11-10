class Mark { constructor(row) { this.left = row.left; this.top = row.top; } }
class Other { constructor(row) { this.other = row.reach; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } }
let turn = 0;
const row = { get left() { if (turn === 5) Object.setPrototypeOf(Round, Other); if (turn === 9) Object.setPrototypeOf(Round, Mark); return turn + 0.5; }, top: 2, reach: 3 };
const said = [];
for (turn = 0; turn < 14; turn++) {
  const made = new Round(row);
  said.push(Object.keys(made).join("") + ":" + made.left + ":" + made.other + ":" + (made instanceof Mark) + (made instanceof Round));
}
console.log(said.join(" | "));
