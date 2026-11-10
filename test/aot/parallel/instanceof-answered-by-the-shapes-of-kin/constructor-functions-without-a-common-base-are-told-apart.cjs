// Four constructor functions whose objects meet in lists; a function that calls itself asks which one made its operand.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 2
function Atom(name) { this.name = name; }
function Num(value) { this.value = value; }
function Ref(name) { this.name = name; this.to = null; }
function Struct(name, args) { this.name = name; this.args = args; }
const words = JSON.parse('["a", 1, "X", ["f", "b", 2, ["g", "Y", 3]], ["h", "c"], 4, "Z"]');
function read(word) {
  if (typeof word === "number") return new Num(word);
  if (typeof word === "string") return word < "a" ? new Ref(word) : new Atom(word);
  return new Struct(word[0], word.slice(1).map(read));
}
const terms = words.map(read);
function weigh(term) {
  if (term instanceof Struct) { let sum = term.name.length; for (let i = 0; i < term.args.length; i++) sum += weigh(term.args[i]); return sum; }
  if (term instanceof Num) return term.value * 10;
  if (term instanceof Atom) return 100;
  if (term instanceof Ref) return 1000;
  return -1;
}
let all = 0;
for (let turn = 0; turn < 60; turn++) for (let i = 0; i < terms.length; i++) all = (all + weigh(terms[i])) % 1000003;
console.log(all);
