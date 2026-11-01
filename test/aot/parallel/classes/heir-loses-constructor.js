// Alone: the second evaluation of a class is known by no table: beside other programs its guards may be left.
// A class made twice, below a class made twice. What the program does to the `constructor` of the heir's prototype object says nothing about whose prototype object it is.
const Base = t => class { constructor() { this.a = t; } };
const Heir = S => class extends S { constructor() { super(); this.b = 5; } };
const ways = {
  delete: D => delete D.prototype.constructor,
  reflect: D => Reflect.deleteProperty(D.prototype, "constructor"),
  accessor: D => Object.defineProperty(D.prototype, "constructor", { get() { return Object; }, configurable: true }),
  properties: D => Object.defineProperties(D.prototype, { constructor: { value: 1, writable: true, configurable: true } }),
  assigned: D => { D.prototype.constructor = Array; },
  mixin: D => {
    class Other { other() { return "other"; } }
    for (const key of Reflect.ownKeys(Other.prototype)) Object.defineProperty(D.prototype, key, Object.getOwnPropertyDescriptor(Other.prototype, key));
  },
};
for (const [name, way] of Object.entries(ways)) {
  for (let i = 0; i < 3; i++) {
    const D = Heir(Base(i));
    way(D);
    const made = new D();
    const keys = [];
    for (const key in made) keys.push(key);
    console.log(name, i, JSON.stringify(made), keys.join(), Object.keys(made).join(), made.a, made.b, made instanceof D, Object.getPrototypeOf(made) === D.prototype);
    console.log(made, structuredClone(made), { ...made });
  }
}
