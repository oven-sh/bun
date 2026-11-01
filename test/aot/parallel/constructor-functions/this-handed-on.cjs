// A constructor function hands its object to a function that hands it to a third; each stores fields. Only the first is read for its fields.
// Flags: --aot-limit=MaxFunctionsGivenThis:1
// STATISTIC: MaxFunctionsGivenThisHits >= 1
function Innermost() {
  this.x = 1;
  this.text = "x";
}
function Middle() {
  Innermost.call(this);
  this.y = 2.5;
}
function Outer(z) {
  Middle.call(this);
  this.z = z;
}
Outer.prototype.sum = function () {
  return this.x + this.y + this.z;
};
function look(o) {
  o.x += 1;
  return [o.sum(), o.x, o.y, o.z, o.text, Object.keys(o).join(), "x" in o, String(o.none)].join(" ");
}
let last = "";
for (let i = 0; i < 300; i++) last = look(new Outer(i));
console.log(last);
console.log(look(new Outer("text")));
