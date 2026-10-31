// `function Base() {}`: the function above fills nothing, and what it makes is the prototype object all the same.
function Base() {}
Base.prototype.who = function () {
  return "base";
};
function Derived() {}
Derived.prototype = new Base();
Derived.prototype.more = function () {
  return this.who() + " and more";
};
function Takes(ignored) {}
function Below() {}
Below.prototype = new Takes(1, 2, 3);
let said = "";
for (let i = 0; i < 3; i++) said += new Derived().more() + " ";
console.log(said, new Derived() instanceof Base, Object.keys(Derived.prototype).join(), new Below() instanceof Takes, Object.getPrototypeOf(Below.prototype) === Takes.prototype);
