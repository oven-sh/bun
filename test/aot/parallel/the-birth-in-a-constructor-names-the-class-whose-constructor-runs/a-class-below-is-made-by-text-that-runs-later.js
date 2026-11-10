class Mark { constructor(row) { this.left = row.left; } where() { return "mark"; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } where() { return "round"; } }
const kinds = { round: Round };
const row = JSON.parse('{"kind":"round","left":1.5,"reach":3}');
const said = [];
for (let turn = 0; turn < 16; turn++) {
  if (turn === 5) kinds.round = new Function("Above", "return class Later extends Above { constructor(row) { super(row); this.later = row.left * 2; } where() { return 'later' + super.where(); } }")(Round);
  if (turn === 11) kinds.round = Round;
  const made = new kinds[row.kind](row);
  said.push(made.where() + Object.keys(made).join("") + (made instanceof Round) + made.constructor.name + (made.later ?? ""));
}
console.log(said.join(" "));
