// Private methods used as values: where the first read happens (a loop, a `try`, a branch) makes no difference to their identity (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

function make(n) {
  return class P {
    static #m() { return n; }
    static #heard() { P.log.push("fired " + n); }
    static log = [];
    static get() { return P.#m; }
    static firstInLoop() { const fs = []; for (let i = 0; i < 5; i++) fs.push(P.#m); return fs.every(f => f === fs[0]) && fs[4] === P.get(); }
    static firstInTry() { let f, g, h; try { f = P.#m; throw 1; } catch { g = P.#m; } finally { h = P.#m; } return f === g && g === h && h === P.get(); }
    static firstInBranch(c) { let a; if (c) a = P.#m; const b = P.#m; return (c ? a === b : a === undefined) && b === P.get(); }
    static firstDropped() { P.#m; (P.#m).k = 1; return (P.#m).k; }
    static firstOnlyCompared() { return P.#m === P.#m && P.#m === P.get(); }
    static firstOnlyTested() { return (P.#m ? 1 : 0) + " " + typeof P.#m + " " + (P.#m === P.get()); }
    static acrossCollection() { (P.#m).k = 7; collect(); collect(); return (P.#m).k; }
    static hot() { const f = P.get(); let bad = 0; for (let i = 0; i < 100000; i++) if (P.get() !== f || P.#m !== f) bad++; return bad; }
    static *suspended() { const a = P.#m; yield 1; const b = P.#m; yield a === b && b === P.get(); }
    static async awaited() { const a = P.#m; await null; const b = P.#m; return a === b && b === P.get(); }
    static listen(s) { s.add(P.#heard); s.delete(P.#heard); return s.size; }
    static count() { return (P.#m).calls = ((P.#m).calls || 0) + 1; }
    static assigned() { Object.assign(P.#m, { k: 7 }); return "k" in P.#m; }
    static frozen() { Object.freeze(P.#m); return Object.isFrozen(P.#m); }
    static inCallback() { return [1, 2, 3].map(() => P.#m).every(f => f === P.#m); }
    static bound() { return P.#m.bind(null)() + " " + (P.#m.bind(null) === P.#m.bind(null)); }
  };
}
row("first read in a loop", () => make(1).firstInLoop());
row("first read in a try", () => make(1).firstInTry());
row("first read in a branch taken", () => make(1).firstInBranch(true));
row("first read in a branch not taken", () => make(1).firstInBranch(false));
row("first read dropped", () => make(1).firstDropped());
row("first read only compared", () => make(1).firstOnlyCompared());
row("first read only tested", () => make(1).firstOnlyTested());
row("a property across collections", () => make(1).acrossCollection());
row("hot", () => make(1).hot());
row("across a yield", () => { const it = make(1).suspended(); it.next(); return it.next().value; });
make(1).awaited().then(v => console.log("across an await: " + v));
row("a listener is taken off", () => { const C = make(1), s = new Set(); const left = C.listen(s); for (const h of s) h(); return left + " [" + C.log.join() + "]"; });
row("a count by class", () => { const A = make(1), B = make(2); return [A.count(), A.count(), B.count(), A.count(), B.count()].join(); });
row("Object.assign", () => make(1).assigned());
row("frozen", () => make(1).frozen());
row("in a callback", () => make(1).inCallback());
row("bound", () => make(3).bound());
function twice(C) { return C.get() === C.get(); }
row("the reader inlined into a caller outside", () => { const C = make(1); let ok = true; for (let i = 0; i < 1000; i++) ok = ok && twice(C); return ok; });
row("a thousand evaluations", () => { const fs = []; for (let i = 0; i < 1000; i++) fs.push(make(i).get()); collect(); return new Set(fs).size + " " + fs[0]() + " " + fs[999](); });
row("a thousand evaluations, each read twice", () => { let same = 0; for (let i = 0; i < 1000; i++) { const C = make(i); if (C.get() === C.get()) same++; } return same; });
function nest(depth) { const C = make(depth); const f = C.get(); return depth ? [f, ...nest(depth - 1), C.get()] : [f, C.get()]; }
row("recursion", () => { const fs = nest(4); return new Set(fs).size + " " + fs.map(f => f()).join(""); });
