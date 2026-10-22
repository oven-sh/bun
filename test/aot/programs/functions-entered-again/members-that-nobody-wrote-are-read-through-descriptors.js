// What a descriptor of a prototype object holds without anybody having written it: the methods of a class, its accessors, and `constructor`.
class Source { greet() { return "hello " + this.name; } get loud() { return this.name.toUpperCase(); } static make() { return new Source(); } }
class Target { constructor(name) { this.name = name; } }
for (const key of ["greet", "loud"]) Object.defineProperty(Target.prototype, key, Object.getOwnPropertyDescriptor(Source.prototype, key));
const target = new Target("ada");
console.log(target.greet(), target.loud);
const method = Object.getOwnPropertyDescriptor(Source.prototype, "greet").value;
console.log(method.call({ name: "bob" }), typeof Object.getOwnPropertyDescriptor(Source, "make").value);
const runs = [];
function Counted() { let mine = runs.length; runs.push(() => mine); if (runs.length < 3) new (Reflect.getOwnPropertyDescriptor(Counted.prototype, "constructor").value)(); mine += 10; }
new Counted();
console.log(runs.map(read => read()).join());
function named() {}
console.log(Object.getOwnPropertyDescriptor(named, "name").value, Object.getOwnPropertyDescriptor(named, "length").value, Object.getOwnPropertyDescriptor(named, "prototype").value === named.prototype);
