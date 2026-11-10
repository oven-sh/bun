// From turn five on the constructor of the class above answers with an older object, in turn an instance of it and an object of no class: `this` of the class below is that object, and the fields and stores of the class below land on it.
const kept = [];
let turn = 0;
class Plain { id; note; constructor(id) { this.id = id; this.note = "p"; if (turn >= 5) return kept[turn % 2]; } }
class Noted extends Plain { mark = "m"; constructor(id, note) { super(id); this.note = note; this.extra = id; } }
kept.push(new Plain(-1), { loose: true });
function run(count) {
  const parts = [];
  for (turn = 0; turn < count; turn++) {
    const made = new Noted(turn, "n" + turn);
    parts.push((made === kept[0] ? "first" : made === kept[1] ? "second" : "new") + ":" + made.id + made.note + made.mark + made.extra + (made instanceof Noted ? "N" : "-") + (made instanceof Plain ? "P" : "-") + Object.keys(made).join(""));
  }
  return parts.join(" ");
}
console.log(run(9));
