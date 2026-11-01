class Base {}
class Other { hi() { return "hi from Other"; } }
class Kid extends Base {}
function greet(kid) { return kid.hi(); }
function attempt(kid) { try { return greet(kid); } catch (error) { return error.constructor.name + ": " + error.message; } }
console.log(attempt(new Kid()));
Object.setPrototypeOf(Kid.prototype, Other.prototype);
console.log(attempt(new Kid()));
Kid.prototype["h" + "i"] = function () { return "hi from Kid"; };
console.log(attempt(new Kid()));
delete Kid.prototype.hi;
Object.setPrototypeOf(Kid.prototype, Base.prototype);
console.log(attempt(new Kid()));
const own = new Kid();
own.hi = () => "hi of its own";
console.log(attempt(own), attempt(new Kid()));
for (let i = 0; i < 3000; i++) attempt(i % 2 ? own : new Kid());
console.log(attempt(own), attempt(new Kid()));
