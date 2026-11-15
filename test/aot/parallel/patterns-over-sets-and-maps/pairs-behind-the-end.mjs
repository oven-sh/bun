// A pattern that takes a pair apart throws where the step in front of it is done.
const said = [];
const show = v => v instanceof Map ? "Map(" + v.size + ")" : v instanceof Set ? "Set(" + v.size + ")" : Array.isArray(v) ? "[" + v.map(show) + "]" : String(v);
class Held extends Map { }
const makers = {
    map: () => new Map([["k", 2]]),
    held: () => new Held([["k", 2]]),
    set: () => new Set([["k", 2]]),
    list: () => [["k", 2]],
    empty: () => new Map(),
    two: () => new Map([["k", 2], ["l", 3]]),
};
const empty = c => { if (Array.isArray(c)) c.length = 0; else c.clear(); };
function taken(S, out) { for (let i = 0; i < 2; i++) { const [[a, b]] = S; out.push(a, b); empty(S); out.push(S); const [x] = S; out.push(x); } }
function takenOfMap(out) { const S = new Map([["k", 2]]); for (let i = 0; i < 2; i++) { const r = []; const [[a, b]] = S; r.push(a, b); S.clear(); r.push(S); out.push(r); const [x] = S; r.push(x); } }
function takenOfMapByLoop(out) { const S = new Map([["k", 2]]); for (let i = 0; i < 2; i++) { const [[a, b]] = S; out.push(a, b); S.clear(); out.push(S); for (const x of S) out.push(x); } }
function takenOfMapByDelete(out) { const S = new Map([["k", 2]]); for (let i = 0; i < 2; i++) { const [[a, b]] = S; out.push(a, b); S.delete("k"); out.push(S); const [x] = S; out.push(x); } }
function filledAgain(out) { const S = new Map([["k", 2]]); for (let i = 0; i < 4; i++) { const [[a, b]] = S; out.push(a, b); S.clear(); out.push(S); const [x] = S; out.push(x); if (i < 2) S.set("z" + i, i); } }
function takenInTry(out) { const S = new Map([["k", 2]]); for (let i = 0; i < 3; i++) { try { const [[a, b]] = S; out.push(a, b); } catch (e) { out.push(e.name, i); } S.clear(); out.push(S); const [x] = S; out.push(x); } }
function assigned(out) { const S = new Map([["k", 2]]); let a, b; for (let i = 0; i < 2; i++) { [[a, b]] = S; out.push(a, b); S.clear(); out.push(S); for (const x of S) out.push(x); } }
function takenOfEntries(S, out) { for (let i = 0; i < 2; i++) { const it = S.entries(); out.push(typeof it); const [[a, b]] = it; out.push(a, b); empty(S); out.push(S); } }
function takenOfIndexes(out) { const l = ["p"]; for (let i = 0; i < 2; i++) { const [[a, b]] = l.entries(); out.push(a, b); l.length = 0; out.push(l); const [x] = l; out.push(x); } }
function firstThatIsReturned(m) { for (const [a, b] of m) return [a, b]; return "none"; }
const attempt = (name, f) => { const out = []; try { f(out); } catch (e) { out.push(e.constructor.name); } said.push(name + " " + out.map(show).join()); };
for (let turn = 0; turn < 2; turn++) {
    for (const name in makers) {
        attempt("taken " + name, out => taken(makers[name](), out));
        attempt("entries " + name, out => takenOfEntries(makers[name](), out));
        attempt("first " + name, out => out.push(firstThatIsReturned(makers[name]())));
    }
    for (const f of [takenOfMap, takenOfMapByLoop, takenOfMapByDelete, filledAgain, takenInTry, assigned, takenOfIndexes]) attempt(f.name, f);
}
for (const line of said) console.log(line);
