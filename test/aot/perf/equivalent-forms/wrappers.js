// The same constructor functions inside a function that is called where it stands, as bundles and older libraries wrap their code: once called plainly, once through `call`.
// ../equivalent-forms.test.ts holds the pair together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const loops = {};

(function () {
  function Counter(step) {
    this.step = step;
    this.total = 0;
    this.next = null;
  }
  Counter.prototype.advance = function () {
    this.total = (this.total + this.step) & 0xffff;
    return this.next;
  };
  Counter.prototype.isDone = function () {
    return this.next === null;
  };
  function Ring(size) {
    this.first = null;
    for (var i = 0; i < size; i++) {
      var counter = new Counter(i + 1);
      counter.next = this.first;
      this.first = counter;
    }
  }
  Ring.prototype.turn = function () {
    var sum = 0;
    for (var counter = this.first; counter !== null; counter = counter.advance())
      sum += counter.isDone() ? counter.total : 1;
    return sum;
  };
  var ring = new Ring(8);
  loops["a wrapper that is called"] = function (n) {
    var sum = 0;
    for (var i = 0; i < n; i++) sum = (sum + ring.turn()) & 0xffffff;
    return sum;
  };
})();

(function () {
  function Counter(step) {
    this.step = step;
    this.total = 0;
    this.next = null;
  }
  Counter.prototype.advance = function () {
    this.total = (this.total + this.step) & 0xffff;
    return this.next;
  };
  Counter.prototype.isDone = function () {
    return this.next === null;
  };
  function Ring(size) {
    this.first = null;
    for (var i = 0; i < size; i++) {
      var counter = new Counter(i + 1);
      counter.next = this.first;
      this.first = counter;
    }
  }
  Ring.prototype.turn = function () {
    var sum = 0;
    for (var counter = this.first; counter !== null; counter = counter.advance())
      sum += counter.isDone() ? counter.total : 1;
    return sum;
  };
  var ring = new Ring(8);
  loops["a wrapper that is called through call"] = function (n) {
    var sum = 0;
    for (var i = 0; i < n; i++) sum = (sum + ring.turn()) & 0xffffff;
    return sum;
  };
}).call(globalThis);

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
