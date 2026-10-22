class Base { constructor() { this.x = 1; this.on = new.target.name; } }
class Derived extends Base { constructor() { super(); this.y = 2; } }
class Other extends Base { constructor() { super(); this.z = 3; } }
function Plain() { this.p = new.target === Plain ? "own" : new.target && new.target.name; }
function Second() { this.s = new.target === Second ? "own" : new.target && new.target.name; }
function show(o) { return Object.getPrototypeOf(o).constructor.name + ":" + Object.keys(o).join(",") + ":" + Object.values(o).join(","); }
const lines = [];
for (let i = 0; i < 6; i++) {
  lines.push(show(new (i % 2 ? Derived : Other)()));
  lines.push(show(new (i % 3 ? Plain : Second)()));
  lines.push(show(new (i % 3 === 0 ? Derived : i % 3 === 1 ? Plain : Base)()));
}
lines.push(show(Reflect.construct(Derived, [], Other)));
lines.push(show(Reflect.construct(Other, [], Derived)));
lines.push(show(Reflect.construct(Plain, [], Second)));
lines.push(show(Reflect.construct(Base, [], Plain)));
const table = [Derived, Other, Plain, Second, Base];
for (const C of table) lines.push(show(new C()));
const bound = Derived.bind(null);
lines.push(show(new bound()));
lines.push(show(new (lines.length > 3 ? bound : Other)()));
console.log(lines.join("\n"));
