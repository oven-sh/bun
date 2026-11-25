class Mark { constructor(row) { this.left = row.left; } where() { return "mark"; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; for (let i = 0; i < 1; i++) this.turns = i; } where() { return "round"; } }
class Ring extends Round { constructor(row) { super(row); this.hole = 1; } where() { return "ring"; } }
function tell(made) { return made.where() + made.reach; }
const row = { left: 1.5, reach: 3 };
const said = [];
for (let turn = 0; turn < 12; turn++) said.push(tell(turn % 2 ? new Ring(row) : new Round(row)));
console.log(said.join(" "));
