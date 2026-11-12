// `this` of a constructor function that a class stands below is also a literal, an object out of unseen code, a frozen object, a primitive and nothing.
const unseen = x => [x][JSON.parse("0")];
class O { constructor() { this.x = 1; } m() { return this.x; } }
const o = new O();
function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
const attempt = work => { try { return work(); } catch (error) { return error.constructor.name; } };
const literal = { held: 0, other: 1 };
const hidden = unseen({ other: 2 });
console.log(new A(o).held === o, attempt(() => Base.call(literal, o)), literal.held === o, Object.keys(literal).join());
console.log(attempt(() => Base.apply(hidden, [o])), hidden.held.m(), Object.keys(hidden).join());
console.log(attempt(() => Base.call(Object.freeze({}), o)), attempt(() => Base.call(5, o)), attempt(() => Base.call(undefined, o)), attempt(() => Base(o)));
console.log(attempt(() => Reflect.apply(Base, unseen(new A(1)), [o]).held), attempt(() => { const a = unseen(new A(1)); Base.apply(a, unseen([o])); return a.held.m() + a.y; }));
hidden.held.x = 7;
console.log(o.m());
