class Mark { constructor(row) { this.left = row.left; } where() { return "mark"; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } where() { return "round"; } }
function Old() {}
Old.prototype = { where() { return "old"; } };
function build(target, row) { return Reflect.construct(Round, [row], target); }
function tell(made) { return made.where() + made.reach + (made instanceof Round); }
const row = { left: 1.5, reach: 3 };
const said = [];
for (let turn = 0; turn < 12; turn++) said.push(tell(build(turn % 3 ? Round : Old, row)), tell(new Round(row)));
console.log(said.join(" "));
