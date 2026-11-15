// Three functions ask for overlapping sets of four constructor functions: {Ref, Struct}, {Num, Ref, Struct}, {Atom, Num, Struct}. The sets nest in no one family, and Ref stands in none:
// what the value is expected to be says which families hold the strangers to Ref.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 8
function Atom(name) { this.name = name; }
function Num(value) { this.value = value; }
function Ref(name) { this.name = name; this.to = null; }
function Struct(name, args) { this.name = name; this.args = args; }
const words = JSON.parse('["a", 1, "X", ["f", "b", 2, ["g", "Y", 3, "X"]], ["h", "c", "Z"], 4, "Z"]');
function read(word) {
  if (typeof word === "number") return new Num(word);
  if (typeof word === "string") return word < "a" ? new Ref(word) : new Atom(word);
  return new Struct(word[0], word.slice(1).map(read));
}
const terms = words.map(read);
function copy(term) {
  if (term instanceof Ref) return new Ref(term.name + "'");
  if (term instanceof Struct) { const args = new Array(term.args.length); for (let i = 0; i < args.length; i++) args[i] = copy(term.args[i]); return new Struct(term.name, args); }
  return term;
}
function alike(a, b) {
  if (a instanceof Ref) return b instanceof Ref;
  if (a instanceof Num) return b instanceof Num && a.value === b.value;
  if (a instanceof Struct) {
    if (!(b instanceof Struct) || a.name !== b.name || a.args.length !== b.args.length) return false;
    for (let i = 0; i < a.args.length; i++) if (!alike(a.args[i], b.args[i])) return false;
    return true;
  }
  return a === b;
}
function weigh(term) {
  if (term instanceof Num) return term.value;
  if (term instanceof Atom) return 10;
  if (term instanceof Struct) { let sum = 100; for (let i = 0; i < term.args.length; i++) sum += weigh(term.args[i]); return sum; }
  return 1000;
}
let all = 0;
for (let turn = 0; turn < 60; turn++) {
  for (let i = 0; i < terms.length; i++) {
    const twin = copy(terms[i]);
    all = (all + weigh(twin) + (alike(twin, terms[i]) ? 1 : 0) + (alike(twin, terms[(i + 1) % terms.length]) ? 7 : 0)) % 1000003;
  }
}
console.log(all);
