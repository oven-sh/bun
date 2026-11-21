// Names that every function has or inherits, assigned behind a class: some are refused, some replace what stands above.
class C { static m() { return "m"; } }
const tryTo = f => { try { return f(); } catch (error) { return error.constructor.name; } };
for (const [name, store] of [["name", () => { C.name = "n"; }], ["length", () => { C.length = 5; }], ["prototype", () => { C.prototype = {}; }], ["caller", () => { C.caller = 1; }], ["call", () => { C.call = 2; }], ["toString", () => { C.toString = () => "text"; }], ["m", () => { C.m = () => "replaced"; }], ["constructor", () => { C.constructor = 3; }], ["displayName", () => { C.displayName = "d"; }], ["plain", () => { C.plain = 4; }]])
  console.log(name, tryTo(store), tryTo(() => String(typeof C[name])), Object.hasOwn(C, name));
console.log(C.m(), C.plain, C.call, C.displayName, Object.keys(C).join(), Reflect.ownKeys(C).join());
class Above { static set fromAbove(value) { this.seen = value; } static get fixed() { return "fixed"; } }
class Below extends Above {}
Below.fromAbove = 7;
console.log(Below.seen, Object.keys(Below).join(), tryTo(() => { Below.fixed = 1; }), Below.fixed);
