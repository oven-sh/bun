class Mark { constructor(row) { this.left = row.left; } }
function make(tag) { return class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } tag() { return tag; } }; }
const kinds = [make("a"), make("b"), make("c")];
const row = JSON.parse('{"left":1.5,"reach":3}');
const said = [];
for (let turn = 0; turn < 18; turn++) {
  const kind = kinds[turn % 3], other = kinds[(turn + 1) % 3];
  const made = turn < 9 ? new kind(row) : Reflect.construct(kind, [row], other);
  said.push(made.tag() + (Object.getPrototypeOf(made) === kind.prototype ? "own" : Object.getPrototypeOf(made) === other.prototype ? "other" : "neither") + (made instanceof kind) + Object.keys(made).join(""));
}
console.log(said.join(" "));
