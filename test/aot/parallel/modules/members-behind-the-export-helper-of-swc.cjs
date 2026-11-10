// Members of an object that an export helper has filled with getters: live, before their start, handed on, defined again.
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
const out = [], t = f => { try { return String(f()); } catch (e) { return e.name + (e.code || ""); } };
out.push(t(() => early()));
function early() { return lib_exports.add(1, 2); }
var lib_exports = {};
_export(lib_exports, { add: () => add, count: () => count, inc: () => inc, late: () => late, Kind: () => Kind, whose: () => whose, default: () => lib_default, odd: () => count + 1, block: () => { return count; }, func: function () { return this === lib_exports; }, limit: () => limit, "a-b": () => add });
var other_exports = {};
_export(other_exports, { add: () => mul, again: () => lib_exports });
let count = 0; const limit = 5;
function add(a, b) { return a + b; } function mul(a, b) { return a * b; } function inc(by = 1) { count += by; return count; } function whose() { return this === lib_exports; } var lib_default = "d";
out.push(t(() => lib_exports.late), t(() => typeof lib_exports.Kind), t(() => lib_exports.count), t(() => lib_exports.inc()), t(() => lib_exports.count));
let late = "now"; class Kind { static made = 0; constructor(v) { this.v = v; Kind.made++; } }
for (let i = 0; i < 40; i++) { const r = [lib_exports.add(i, 1), other_exports.add(i, 2), lib_exports.inc(2), lib_exports.count, lib_exports.late, new lib_exports.Kind(i).v, lib_exports.whose(), (0, lib_exports.whose)(), lib_exports.default, lib_exports.odd, lib_exports.block, lib_exports.func, lib_exports["a-b"](1, 1), lib_exports.limit, typeof lib_exports.none, lib_exports?.add(1, 1), lib_exports["co" + "unt"], other_exports.again.add(2, 2)]; if (i === 0 || i === 39) out.push(r.join()); }
late = [1]; out.push(t(() => lib_exports.late.length)); lib_default = undefined; out.push(t(() => lib_exports.default));
out.push(Object.keys(lib_exports).join(), t(() => JSON.stringify({ ...other_exports }).length), Object.getOwnPropertyDescriptor(lib_exports, "count").enumerable, Object.getOwnPropertyDescriptor(lib_exports, "count").configurable, t(() => { Object.defineProperty(lib_exports, "count", { value: 9 }); }), t(() => { Object.defineProperty(lib_exports, "count", { get: () => 9 }); }), t(() => { "use strict"; return lib_exports.count; }));
const hand = [lib_exports].map(o => { try { Object.defineProperty(o, "inc", { value: 1 }); } catch (e) { return e.name; } }); out.push(hand.join(), lib_exports.inc(0)); let s = ""; for (const k in lib_exports) s += k[0]; out.push(s);
const { inc: taken, limit: five } = lib_exports; out.push(taken(1), five, lib_exports.count); Object.freeze(lib_exports); out.push(lib_exports.inc(1), lib_exports.count, typeof lib_exports.add);
console.log(out.join(" "));
