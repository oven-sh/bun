// A function is given, ahead of its first construction, a `prototype` that other objects stand below already: Object.prototype, and the prototype object of another function.
function Wide(x) { this.x = x; }
function Lender(x) { this.x = x; }
function Taker(y) { this.y = y; }
function isWide(o) { return o instanceof Wide; }
function isTaker(o) { return o instanceof Taker; }
function recordIsWide() { const record = { a: 1 }; return record instanceof Wide; }
function lentIsTaker() { const lent = new Lender(1); return lent instanceof Taker; }

function deed() {
  Wide.prototype = Object.prototype;
  Taker.prototype = Lender.prototype;
}
deed();
console.log(String(isWide({})), String(isWide([])), String(isWide(new Wide(1))), String(isWide(Object.create(null))), String(isWide(5)), String(recordIsWide()));
console.log(String(isTaker(new Lender(1))), String(isTaker(new Taker(1))), String(isTaker({})), String(lentIsTaker()));
let count = 0;
for (let i = 0; i < 200; i++) count += (isWide(i & 1 ? {} : new Wide(i)) ? 1 : 0) + (isTaker(i & 1 ? new Lender(i) : new Taker(i)) ? 1 : 0) + (recordIsWide() ? 1 : 0) + (lentIsTaker() ? 1 : 0);
console.log(String(count));
