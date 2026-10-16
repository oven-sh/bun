// A method whose computed name is "constructor" is an ordinary method: it takes the place of the property that names the class.
class Odd { ["constructor"]() { return "a method"; } other() { return 1; } }
class Even { ["con" + "structor"]() { return "another"; } }
class Heir extends Odd { more() { return 2; } }
class Getter { get ["constructor"]() { return "from a getter"; } }
function calls(value, turns) { let text = ""; for (let i = 0; i < turns; i++) text = value.constructor(); return text; }
function reads(value, turns) { let seen; for (let i = 0; i < turns; i++) seen = value.constructor; return seen; }
console.log(calls(new Odd(), 1), calls(new Even(), 1), reads(new Heir(), 1) === Heir, reads(new Getter(), 1));
console.log(calls(new Odd(), 100), calls(new Even(), 100), reads(new Heir(), 100) === Heir, reads(new Getter(), 100), new Odd().other(), new Heir().more());
console.log(Odd.prototype.constructor === Odd, typeof Odd.prototype.constructor, Odd.prototype.constructor.name, Object.getOwnPropertyNames(Odd.prototype).join(), Object.getOwnPropertyNames(Getter.prototype).join());
