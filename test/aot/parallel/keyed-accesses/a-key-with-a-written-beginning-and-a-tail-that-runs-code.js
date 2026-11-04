// `o["on" + tail] = v`: the tail is an object whose conversion runs code, throws, or gives a symbol. The order of what happens and the name that is stored under are those of plain code.
// Under: --aot-testing=CheckProofsAtRunTime: the effects of a store under a key with a written beginning
function listen(o, tail, value) { o["on" + tail] = value; }
const lines = [];
function attempt(f) { try { f(); } catch (error) { lines.push(error.constructor.name + ": " + error.message); } }
const target = { onopen: 0, set onset(value) { lines.push("setter " + value); } };
attempt(() => listen(target, { toString() { lines.push("toString"); target.onlate = "laid by the conversion"; return "open"; } }, 1));
attempt(() => listen(target, { valueOf() { lines.push("valueOf"); return "set"; }, toString() { lines.push("never"); return "x"; } }, 2));
attempt(() => listen(target, { toString() { throw new RangeError("no text"); } }, 3));
attempt(() => listen(target, Symbol("s"), 4));
attempt(() => listen(target, { [Symbol.toPrimitive](hint) { lines.push("hint " + hint); return 5; } }, 5));
attempt(() => listen(null, { toString() { lines.push("converted before the store fails"); return "x"; } }, 6));
attempt(() => listen(target, undefined, 7));
attempt(() => listen(Object.freeze({ onopen: 0 }), "open", 8));
lines.push(JSON.stringify(target));
console.log(lines.join("\n"));
