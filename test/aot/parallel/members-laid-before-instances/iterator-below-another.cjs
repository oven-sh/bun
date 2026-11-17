// A function lays the prototypes of its constructors before it calls anything: literals with methods and accessors, and one linked below another.
const Counter = (function () {
  function Walker(list) { this.list = list; this.position = 0; this.last = null; }
  Walker.prototype = {
    hasNext: function () { while (this.position < this.list.length) { if (this.list[this.position] === null) this.position++; else return true; } return false; },
    step: function () { this.last = this.list[this.position++]; return this.last; },
    get seen() { return this.position; },
    set seen(value) { this.position = value; },
  };
  function Sum(list) { Walker.call(this, list); this.total = 0; }
  Sum.prototype = { add: function () { return this.total += this.step(); } };
  Sum.prototype.__proto__ = Walker.prototype;
  function Counter(list) { this.list = list; }
  Counter.prototype = { sum: function () { const walker = new Sum(this.list); while (walker.hasNext()) walker.add(); return walker; } };
  return Counter;
})();
const counter = new Counter([1, null, 2, 3, null]);
let text = '';
for (let i = 0; i < 4; i++) { const sum = counter.sum(); text += sum.total + ',' + sum.seen + ';'; sum.seen = i; text += sum.seen + ';'; }
console.log(text, counter.sum() instanceof Counter, Object.keys(counter).join());
