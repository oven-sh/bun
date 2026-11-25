// Either arm gives a new object its late fields in an order of its own: the keys come in the order of the stores.
function Bead(number, color) { this.number = number; this.color = color; }
Bead.prototype.over = null;
Bead.prototype.under = null;
const kinds = { Bead };
function Chain() { this.top = null; }
Chain.prototype.hang = function (number) {
  const bead = new kinds.Bead(number, null);
  if (number % 3 === 1) {
    bead.under = number * 2;
    bead.over = this.top;
  } else if (number % 3 === 2) {
    bead.over = this.top && this.top.under;
    bead.under = "loose";
  } else bead.over = bead.under = this.top;
  if (number % 5 === 0) bead.over = undefined;
  return (this.top = bead);
};
class Cell { constructor(name) { this.name = name; } }
function fill(i) {
  const cell = new Cell("c" + i);
  if (i % 3 === 0) cell.up = i;
  if (i % 2) {
    cell.down = i + 1;
    cell.tag = null;
  } else {
    cell.tag = "even";
    cell.down = i * 0.5;
  }
  if (i % 7 === 0) cell.up = "seven";
  return cell;
}
function other(i) {
  const made = i & 4 ? new kinds.Bead(i, i) : new Cell(i);
  if (i & 1) { made.first = 1; made.second = 2; } else { made.second = 3; made.first = 4; }
  return made;
}
const keys = object => { let names = Object.keys(object).join(); for (const name in object) names += " " + name; return names; };
function run(from, to) {
  const chain = new Chain();
  const seen = new Map();
  const count = (kind, object) => seen.set(kind + ": " + keys(object), (seen.get(kind + ": " + keys(object)) ?? 0) + 1);
  for (let i = from; i < to; i++) {
    count("bead", chain.hang(i));
    count("cell", fill(i));
    count("other", other(i));
  }
  console.log([...seen].map(([kind, n]) => kind + " x" + n).sort().join("\n"));
  let depth = 0;
  for (let bead = chain.top; bead && depth < 100; bead = bead.over) depth++;
  console.log(depth, JSON.stringify(fill(6)), JSON.stringify(fill(21)));
}
run(1, 60);
function Short(number) { this.under = number; this.number = number; }
kinds.Bead = Short;
run(1, 60);
kinds.Bead = function (number) { return Object.freeze({ number }); };
try {
  run(1, 60);
} catch (error) {
  console.log(error.constructor.name);
}
kinds.Bead = Bead;
Object.defineProperty(Bead.prototype, "over", { set(value) { this.seen = typeof value; }, get() { return null; }, configurable: true });
run(1, 60);
