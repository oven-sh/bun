// The idioms `[].slice.call(arguments)` and `Array.prototype.slice.call(arguments, 1)`.
const out = [];
function idiom() { return [].slice.call(arguments); }
function idiomFrom() { return [].slice.call(arguments, 1); }
function byPrototype() { return Array.prototype.slice.call(arguments); }
function ownSlice() { const h = []; h.slice = function () { return Array.isArray(this) + " " + Object.prototype.toString.call(this) + " " + JSON.stringify(this); }; return h.slice.call(arguments); }
function ownSliceByDefine() { const h = []; Object.defineProperty(h, "slice", { value: function () { return Object.prototype.toString.call(this); } }); return h.slice.call(arguments); }
function otherPrototype() { const h = []; Object.setPrototypeOf(h, { slice() { return Object.prototype.toString.call(this); } }); return h.slice.call(arguments); }
function handedOn(f) { const h = []; f(h); return h.slice.call(arguments); }
function named() { const h = []; return h.slice.call(arguments); }
function usedTwice() { const h = [9]; const r = h.slice.call(arguments); return r.concat(h); }
out.push(JSON.stringify(idiom(1, 2, 3)), JSON.stringify(idiomFrom(1, 2, 3)), JSON.stringify(byPrototype("a", "b")), String(Array.isArray(idiom())));
out.push(ownSlice(1), ownSlice(), ownSliceByDefine(1, 2), otherPrototype(1));
out.push(String(handedOn(h => { h.slice = function () { return Object.prototype.toString.call(this); }; })), JSON.stringify(handedOn(h => { })).length > 0 ? "handed on" : "");
out.push(JSON.stringify(named(4, 5)), JSON.stringify(usedTwice(6, 7)));
console.log(out.join("\n"));
