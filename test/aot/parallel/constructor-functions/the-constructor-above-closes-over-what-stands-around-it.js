// The function above is made in a function and reads and writes the variables of that function.
const Linked = (function () {
  let made = 0;
  const seen = [];
  function Base(size) {
    made++;
    seen.push(size);
    this.size = size;
    this.order = made;
  }
  Base.prototype.report = function () {
    return made + ":" + seen.join("-") + ":" + this.order;
  };
  function Derived(size) {
    Base.call(this, size);
  }
  Derived.prototype = new Base(0);
  Derived.prototype.constructor = Derived;
  return { Base, Derived };
})();
const first = new Linked.Derived(1);
const second = new Linked.Base(2);
console.log(first.report(), second.report(), Linked.Derived.prototype.report(), Linked.Derived.prototype.order);
