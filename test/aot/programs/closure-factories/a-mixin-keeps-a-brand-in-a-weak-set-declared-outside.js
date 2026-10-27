// A downleveled `#brand in object`: the WeakSet is declared beside the mixin.
function __classPrivateFieldIn(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
}
const m = new WeakSet();
class P {}
const mix = Base => class extends Base { constructor(v) { super(); m.add(this); } is() { return __classPrivateFieldIn(m, this); } };
class S extends mix(P) {}
console.log(new S(7).is());
