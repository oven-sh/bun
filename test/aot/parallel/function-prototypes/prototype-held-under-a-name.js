// `const target = { .. }; Heir.prototype = target;`: a getter, a method and a value of the named literal are read through an heir without a guard that fails: one look by name a round is left, of three.
const target = {
  get one() {
    return this.b + 1;
  },
  two() {
    return this.b + 2;
  },
  kind: 7,
};
function Heir(b) {
  this.b = b;
}
Heir.prototype = target;
const heirs = [new Heir(1), new Heir(2)];
const units = 1000;
let sum = 0;
for (let unit = 0; unit < units; unit++) {
  const heir = heirs[unit & 1];
  sum += heir.one + heir.two() + heir.kind;
}
console.log(sum > 0 ? "ok" : "no");
