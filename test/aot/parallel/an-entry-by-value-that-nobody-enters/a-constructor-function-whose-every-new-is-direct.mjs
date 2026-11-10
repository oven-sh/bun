// Every `new` of the constructor function is direct and its method's every call is copied: both entries are closed.
// STATISTIC: EntriesThatNobodyEnters >= 2
function Pair(a, b) {
  this.a = a;
  this.b = b;
}
Pair.prototype.sum = function () {
  return this.a + this.b;
};
let total = 0;
for (let i = 0; i < 5; i++) total += new Pair(i, 1).sum();
console.log(total);
