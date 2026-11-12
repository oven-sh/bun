class Mark { constructor(row) { this.left = row.left; } where() { return "mark"; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } where() { return "round"; } }
class Flat extends Mark { constructor(row) { super(row); this.width = row.width; } where() { return "flat"; } }
class Other { where() { return "other"; } }
function Old() {}
Old.prototype.where = function () { return "old"; };
function Bare() {}
Bare.prototype = 5;
const kinds = { round: Round, flat: Flat };
const rows = JSON.parse('[{"kind":"round","left":1.5,"reach":3},{"kind":"flat","left":4,"width":6}]');
const seen = [];
const watched = new Proxy(Round, { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } });
const strangers = [Other, Old, Bare, watched, Round.bind(null), Flat, Mark, Round];
const said = [];
for (let turn = 0; turn < 24; turn++) {
  for (const row of rows) {
    const kind = kinds[row.kind];
    const made = turn < 5 ? new kind(row) : Reflect.construct(kind, [row], strangers[turn % strangers.length]);
    said.push((made.where ? made.where() : "none") + Object.keys(made).join("") + (made instanceof kind ? "+" : "-") + (Object.getPrototypeOf(made) === Object.prototype ? "o" : "") + seen.splice(0).join("."));
  }
}
console.log(said.join(" "));
console.log(new watched(rows[0]).where(), seen.join("."), new (Round.bind(null, rows[0]))().reach);
