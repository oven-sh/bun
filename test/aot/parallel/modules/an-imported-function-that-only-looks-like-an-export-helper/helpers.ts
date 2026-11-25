// @ts-nocheck
var holder = { o: (_: object, __: string) => false };
var d = (e, t) => { for (var r in t) holder.o(t, r) && !holder.o(e, r) && Object.defineProperty(e, r, { enumerable: !0, get: t[r] }); };
var { defineProperty: e } = Object;
var r = (a) => a;
function s(a, b) { this[a] = r.bind(null, b); }
namespace s { export const bind = (all, name) => value => console.log("set", name, value); }
var lay = (a, b) => { for (var c in b) e(a, c, { get: b[c], enumerable: !0, configurable: !0, set: s.bind(b, c) }); };
export { d, lay };
