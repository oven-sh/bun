// The prototype an object is born with is whatever the program says at its birth, as in plain Bun: `__proto__:` in a literal, a subclass, another new.target.
const base = { greet() { return "base"; } };
interface Greeter { name: string; greet(): string }
const literal = { __proto__: base, name: "literal" } as unknown as Greeter;
console.log(literal.greet(), Object.getPrototypeOf(literal) === base, Object.keys(literal).join());
const bare = { __proto__: null, name: "bare" } as { name: string };
console.log(Object.getPrototypeOf(bare), bare.name, "toString" in bare);
class Animal { legs: number = 4; describe() { return "animal " + this.legs; } }
class Bird extends Animal { wings: number = 2; describe() { return "bird " + this.legs + " " + this.wings; } }
function Other() {}
Other.prototype.describe = function () { return "other"; };
const constructed: any = Reflect.construct(Animal, [], Other);
console.log(new Bird().describe(), constructed.describe(), constructed.legs, constructed instanceof Animal, Object.getPrototypeOf(constructed) === Other.prototype);
const replaced = Animal.prototype.describe;
Animal.prototype.describe = function () { return "patched " + this.legs; };
console.log(new Animal().describe());
Animal.prototype.describe = replaced;
console.log(new Animal().describe());
