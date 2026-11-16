// `F.prototype = other`, out of the build's sight, between the turns: the objects made before are no F any more, those made behind are; and a prototype object is laid below another's.
function Atom(name) { this.name = name; }
function Num(value) { this.value = value; }
function Ref(name) { this.name = name; }
const kinds = JSON.parse("[0,1,2,0,1,2,0,1,2]");
const terms = kinds.map((kind, i) => (kind === 0 ? new Atom(i) : kind === 1 ? new Num(i) : new Ref(i)));
const named = text => JSON.parse('"' + text + '"');
const lay = Object[named("setPrototypeOf")], set = Reflect[named("set")];
function count() {
  let sum = 0;
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (term instanceof Atom) sum += 1;
    else if (term instanceof Num) sum += 10;
    else if (term instanceof Ref) sum += 100;
    else sum += 1000;
  }
  return sum;
}
const said = [];
for (let turn = 0; turn < 300; turn++) {
  if (turn === 80) set(Num, "prototype", { fresh: true });
  if (turn === 120) terms.push(new Num(50));
  if (turn === 160) lay(Ref.prototype, Atom.prototype);
  if (turn === 220) lay(terms[0], Ref.prototype);
  const answer = count();
  if (said[said.length - 1] !== answer) said.push(turn, answer);
}
console.log(said.join());
