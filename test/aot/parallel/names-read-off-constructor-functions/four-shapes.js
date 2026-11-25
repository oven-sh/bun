function Base(a) { this.a = a; }
function Below(a, b) { Base.call(this, a); this.b = b; }
Below.prototype = Object.create(Base.prototype);
function Counter(n) { this.n = n; }
Counter.of = function (n) { return new Counter(n + 1); };
function Check(n) { this.n = n; }
Object.defineProperty(Check, "init", { value: function (n) { return n + 2; } });
function Animal(n) { this.n = n; }
Animal.create = function (n) { return n + 3; };
function Dog(n) { Animal.call(this, n); }
Object.setPrototypeOf(Dog, Animal);
Dog.prototype = Object.create(Animal.prototype);
function run(count) {
  let calls = 0, statics = 0, defined = 0, above = 0;
  for (let i = 0; i < count; i++) {
    calls += new Below(i, 1).a + new Dog(i).n;
    statics += Counter.of(i).n;
    defined += Check.init(i);
    above += Dog.create(i);
  }
  return [calls, statics, defined, above].join(" ");
}
console.log(run(10));
