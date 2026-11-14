let text = "";
function say(x) { text += String(x) + ","; }
function plain(v) { switch (typeof v) { case "string": return v.length; case "number": return v * 2 + 1; case "boolean": return v ? 1 : 0; case "object": return v === null ? "null" : v.length ?? v.a; case "function": return v.length; default: return typeof v; } }
function falls(v) { switch (typeof v) { case "string": say(v.length); case "number": say(v * 2); default: say(typeof v); break; case "object": say(v === null); } return v; }
function assigned(v) { switch (typeof v) { case "string": v = v.length; say(v + 1); break; case "number": v = "n" + v; say(v.length); break; default: v = 5; say(v * 2); } return typeof v; }
function again(v) { for (let j = 0; j < 3; j++) { switch (typeof v) { case "string": say(v.length); v = v.length; continue; case "number": say(v + 1); v = j === 1 ? "q" : v; break; default: j = 9; } } return v; }
function caught(v) { switch (typeof v) { case "string": try { v.nothing.more; } catch (e) { say(e.constructor.name + v.length); } finally { say(typeof v); } break; default: say(typeof v); } return v; }
function written(v) { const later = () => { v = 3; }; switch (typeof v) { case "string": later(); say(v * 2); break; case "number": say(v); later(); break; default: later(); say(v + 1); } return v; }
function grouped(v) { switch (typeof v) { case "string": case "number": return String(v).length + v; case "undefined": case "boolean": return String(v); case "bigint": return v + 1n; case "symbol": return v.description; default: return "other"; } }
function nested(v, w) { switch (typeof v) { case "object": switch (typeof w) { case "string": return w.length; case "number": return w + 1; } return "none"; default: switch (typeof v) { case "string": return v.length; default: return typeof v; } } }
function* stepped(v) { switch (typeof v) { case "string": yield v.length; yield v + "!"; break; case "number": yield v + 1; } }
async function awaited(v) { switch (typeof v) { case "string": await 0; return v.length; case "number": await 0; return v + 1; } return typeof v; }
const values = ["text", "", 3, 1.5, NaN, -0, true, null, undefined, [1, 2], { a: 4 }, () => 1, Symbol.iterator, 10n, new Map(), class K {}, Object("boxed")];
for (let t = 0; t < 4; t++) for (const v of values) say([plain, falls, assigned, again, caught, written, grouped].map(f => { try { const x = f(v); return typeof x === "object" || typeof x === "function" ? typeof x : String(x); } catch (e) { return e.constructor.name; } }).join(" ") + nested(v, t & 1 ? "w" : t) + [...stepped(v)].join());
for (const v of values) say(await awaited(v));
console.log(text);
