const unseen = (x) => [x][JSON.parse("0")], no = JSON.parse("false"), log = [];
class Ash { constructor(early) { this.first = 1; if (early) this.late = 0; this.last = 2; } } class Elm { constructor(early) { this.zero = 0; this.first = 1; if (early) this.late = 0; this.last = 2; } }
const make = (n) => unseen(JSON.parse(String(n % 2)) ? new Elm(no) : new Ash(no)); function Same(o) { return o; } class Stamp extends Same { late = JSON.parse("7"); }
const tried = (o) => { try { new Stamp(o); return "defined"; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } };
const deeds = [["A", (o) => o], ["B", (o) => { Object.defineProperty(Object.getPrototypeOf(o), "late", { set(v) { log.push("set " + v); }, configurable: true }); return o; }], ["C", (o) => Object.preventExtensions(o)]];
for (const [name, deed] of deeds) for (let n = 0; n < 2; n++) { const o = deed(make(n)); console.log(name, n, tried(o), Object.keys(o).join(), String(o.late), "[" + log.splice(0).join("+") + "]"); }
