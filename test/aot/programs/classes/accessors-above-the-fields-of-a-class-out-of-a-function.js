// Fields of the class out of the function are defined, never assigned: setters and read-only properties of the classes above do not run or refuse; assignments in constructors do.
const lines = [];
class Base { set value(v) { lines.push("set:" + v); } get value() { return "getter"; } get locked() { return "locked"; } }
const WithFields = (Parent) => class extends Parent { value = 1; locked = 2; };
const WithStores = (Parent) => class extends Parent { constructor() { super(); this.value = 3; try { this.locked = 4; } catch (error) { lines.push(error.constructor.name); } } };
class A extends WithFields(Base) {}
class B extends WithStores(Base) {}
class C extends WithStores(WithFields(Base)) {}
class D extends WithFields(WithStores(Base)) {}
for (const K of [A, B, C, D]) { const made = new K(); lines.push(K.name, made.value, made.locked, Object.keys(made).join("")); }
Object.defineProperty(Base.prototype, "late", { set(v) { lines.push("late:" + v); }, configurable: true });
const Late = (Parent) => class extends Parent { constructor() { super(); this.late = 5; } };
class E extends Late(Base) {}
for (let i = 0; i < 3; i++) lines.push(Object.keys(new E()).length);
delete Base.prototype.late;
lines.push(Object.keys(new E()).join(""));
console.log(lines.join(" "));
