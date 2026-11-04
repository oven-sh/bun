// The constructor of a base stores under names that its prototype declares. One guard stands in front of those stores for all the classes that come to them.
// COUNT: arrivals <= 40500
// Until the end nothing constructs Base, Middle or Other. Their part of the guard is armed once a store of a Leaf has come by name: 60,500 arrivals without that, one more for each object.
function Base(limit) {
  if (this.listeners === undefined || this.listeners === Object.getPrototypeOf(this).listeners) {
    this.listeners = { __proto__: null };
    this.count = 0;
  }
  this.limit = limit;
  this.captures = false;
}
Base.prototype.listeners = undefined;
Base.prototype.count = 0;
Base.prototype.limit = undefined;
Base.prototype.captures = false;
Base.prototype.total = function () {
  return this.count + (this.limit | 0) + (this.captures ? 1 : 0);
};

function Middle(limit) {
  Base.call(this, limit);
  this.middle = 1;
}
Object.setPrototypeOf(Middle.prototype, Base.prototype);
Object.setPrototypeOf(Middle, Base);

function Leaf(limit) {
  Middle.call(this, limit);
  this.leaf = 2;
}
Object.setPrototypeOf(Leaf.prototype, Middle.prototype);
Object.setPrototypeOf(Leaf, Middle);

function Other(limit) {
  Middle.call(this, limit);
  this.other = 3;
}
Object.setPrototypeOf(Other.prototype, Middle.prototype);
Object.setPrototypeOf(Other, Middle);

function Twig(limit) {
  Leaf.call(this, limit);
  this.twig = 4;
}
Object.setPrototypeOf(Twig.prototype, Leaf.prototype);
Object.setPrototypeOf(Twig, Leaf);

const makers = [Leaf, Twig, Base, Middle, Other];
function make(which, limit) {
  return new makers[which](limit);
}

let sum = 0;
let kept;
for (let i = 0; i < 20000; i++) kept = make(i & 1, i & 7);
console.log(kept.total(), kept.leaf, kept.middle);
const last = make(1, 5);
console.log(Object.keys(last).join(), last instanceof Base, last instanceof Middle, last instanceof Other, JSON.stringify(last));

// A setter that comes late on the class that nothing had constructed is seen by the objects below it.
let seen = 0;
Object.defineProperty(Middle.prototype, "limit", { set(value) { seen += value; }, get() { return -1; }, configurable: true });
for (let i = 0; i < 100; i++) sum += make(i & 1, 3).total();
console.log(sum, seen, Object.keys(make(0, 1)).join(), make(0, 1).limit);
delete Middle.prototype.limit;
console.log(make(0, 9).limit, make(3, 8).limit, make(4, 7).other, make(2, 6).limit);
