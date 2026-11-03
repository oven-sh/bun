// Some objects of one literal and some instances of one class below Number get a member named toJSON behind their creation. The others find none.
function make(i) {
  const o = { a: i };
  if (i & 1) o.toJSON = function () { return "json:" + this.a; };
  return o;
}
class Amount extends Number {
  constructor(i) {
    super(i);
    this.x = i;
    if (i & 2) this.toJSON = () => "amount:" + i;
  }
}
let total = 0;
for (let i = 0; i < 100000; i++) {
  const o = make(i);
  total += o.toJSON === undefined ? 1 : 2;
  const amount = new Amount(i);
  total += amount.toJSON === undefined ? 3 : 4;
}
console.log(total);
console.log(JSON.stringify(make(3)), JSON.stringify(make(2)), JSON.stringify(new Amount(2)), JSON.stringify(new Amount(1)));
console.log("toJSON" in make(2), "toJSON" in make(3), Object.keys(new Amount(2)).join(), Object.keys(new Amount(1)).join());
