// Loops over objects of several constructor functions, each with methods of its own.
function Base(n) { this.n = n; this.i = 0; }
Base.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
Base.prototype.get = function () { return this.n; };
function make(own) {
  function Child(n) { Base.call(this, n); }
  Child.prototype = Object.create(Base.prototype);
  Child.prototype.constructor = Child;
  Child.prototype.own = own;
  return Child;
}
function First(n) { Base.call(this, n); }
First.prototype = Object.create(Base.prototype);
First.prototype.own = function () { return this.get(); };
function Second(n) { Base.call(this, n); }
Second.prototype = Object.create(Base.prototype);
Second.prototype.own = function () { return this.get() + 1; };
function Third(n) { Base.call(this, n); }
Third.prototype = Object.create(Base.prototype);
Third.prototype.own = function () { let sum = 0; for (let i = 0; i < 3; i++) sum += this.n; return sum; };
function Fourth(n) { Base.call(this, n); this.text = "t" + n; }
Fourth.prototype = Object.create(Base.prototype);
Fourth.prototype.own = function (more) { if (more === 7) throw new RangeError(this.text); return this.text.length; };

function run(list, more) {
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const object = list[i % list.length];
    sum = (sum + object.step() + object.own(more)) | 0;
  }
  return sum;
}
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name + " " + error.message;
  }
}
const two = [new First(1), new Second(2), new First(3), new Second(4)];
const four = [new First(1), new Second(2), new Third(3), new Fourth(4)];
console.log(run(two), run(four), run([new First(0.5), new Second("x")]), attempt(() => run(four, 7)), attempt(() => run([new First(1), null])));
const Made = make(function () { return this.n * 100; }), Other = make(function () { return -this.n; });
console.log(run([new Made(1), new Other(2)]), run([new Made(1), new First(2)]));
const replaced = new First(9);
replaced.own = () => 1000;
console.log(run([replaced, new Second(1)]), run(two));
Second.prototype.own = function () { return 5000; };
console.log(run(two));
delete First.prototype.own;
console.log(attempt(() => run(two)));
First.prototype = { step() { return 1; }, own() { return 2; } };
console.log(run([new First(1), new Second(1)]));
