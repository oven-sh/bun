// What a species constructor of the program has made is written by the built-in that asked for it.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
class Splitter { lastIndex = { qa: 1 }; exec(s) { seen.push(attempt(() => this.lastIndex.qa) + ":" + typeof this.lastIndex); return null; } }
const r = /,/; r.constructor = { [Symbol.species]: Splitter };
console.log("a,b".split(r).length, seen.join("|"));
seen.length = 0;
const r2 = /,/g; r2.constructor = { [Symbol.species]: Splitter };
console.log([..."a,b".matchAll(r2)].length, seen.join("|"));
console.log(attempt(() => new Splitter().lastIndex.qa));
class Cap { constructor(ex) { ex(v => { this.got = v; }, () => {}); } got = { qa: 2 }; }
const c = Promise.resolve.call(Cap, 5); console.log(c instanceof Cap, attempt(() => c.got.qa), typeof c.got);
