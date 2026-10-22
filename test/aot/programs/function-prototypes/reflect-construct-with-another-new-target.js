// Reflect.construct runs one plain function with another as new.target: the object lies below the prototype object of the second.
function Meter() { seen.push(new.target === Other, this instanceof Other, this instanceof Meter, typeof this.name); }
function Other() {}
const seen = [];
Meter.prototype.name = function () { return 1; };
Other.prototype.name = function () { return "other"; };
const made = Reflect.construct(Meter, [], Other);
const plain = new Meter();
console.log(seen.join(), typeof made.name(), typeof plain.name(), Object.getPrototypeOf(made) === Other.prototype);
