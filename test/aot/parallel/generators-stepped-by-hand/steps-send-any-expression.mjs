// What a step sends may be any expression; a generator may try, catch and loop before the only step that is taken.
function* echo(x) { let got = x; while (got !== "stop") got = yield got; return "end"; }
function* tries(x, list) { for (let w = 0; w < 3; w++) { for (let j = x ? 0 : 1; j < 2; j++) { if (list[j] === x) continue; try { if (x === 2) throw new Error("two"); if (w) yield [w, j]; } catch (error) { yield error.message; } finally { x--; } } } return x; }
function sums(x) { const it = echo(x); const all = []; for (let r = it.next(); !r.done && all.length < 4; r = it.next(all.length + x)) all.push(r.value); return all; }
function texts(x) { const it = echo(x); const all = []; let r; while (!(r = it.next("s" + x + all.length)).done && all.length < 4) all.push(r.value); return all; }
function ends(x) { const it = echo(x); const all = []; while (true) { const r = it.next(x + "op"); if (r.done) break; if (all.length > 4) break; all.push(r.value); } return all; }
function templates(x) { const it = echo(x); const all = []; for (;;) { const { value, done } = it.next(`${x}${all.length}`); if (done || all.length > 3) break; all.push(value); } return all; }
function rows(x) { const all = []; for (let z = 0; z < 2; z++) { const it = echo(x); const a = it.next(x + 1); const b = it.next("r" + x); const c = it.next(x + a.value); all.push(a.value, b.value, c.value); } return all; }
function starts(x) { const all = []; for (let z = 0; z < 2; z++) { const it = echo(x); all.push(it.next("a").value, String(it.next("b" + x).value).startsWith("b" + x)); } return all; }
function only(x) { const all = []; for (let z = 0; z < 2; z++) { const it = tries(x, [3, 1]); all.push(it.next({ z }).value); } return all; }
const out = [];
for (let turn = 0; turn < 3; turn++) {
    for (const f of [sums, texts, ends, templates, rows, starts, only]) {
        for (const x of [0, 1, 2, 3, "a", "st", undefined, null, 1.5]) {
            try { out.push(f.name + " " + String(x) + " " + f(x).map(v => Array.isArray(v) ? "[" + v + "]" : String(v)).join()); } catch (error) { out.push(f.name + " " + error.name); }
        }
    }
}
console.log(out.join("\n"));
