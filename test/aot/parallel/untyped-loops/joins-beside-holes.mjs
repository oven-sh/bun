// Lists joined: texts, small and great numbers, -0, NaN, holes, undefined, null, bigints, lists in lists, objects with toString, a list in itself; separators of none, one and several characters.
function f0() { const l = ["a", -1]; l.length += 2; return `${l}`; }
function f1() { const l = Array.from({ length: 18 }, (_, i) => i * 0.5);  return l.join("-"); }
function f2() { const l = ["Ā"]; l.length += 2; return `${l}`; }
function f3() { const l = [-1, null]; l.length += 2; return l.join(null); }
function f4() { const l = new Array(2);  return l.join("-"); }
function f5() { const l = new Array(2);  return l.join("é"); }
function f6() { const l = new Array(1); l.push(l); return l.join(undefined); }
function f7() { const l = [null, null, null, -0, "", "", undefined, null, "long text of more than eight", , o, NaN, "long text of more than eight", "", "long text of more than eight", "a", ]; l[11] = []; return l.join(); }
let heard = 0; const o = { toString() { heard++; return "o" + heard % 3; } };
const show = t => JSON.stringify(t.length > 120 ? t.length + t.slice(0, 100) : t);
for (let round = 0; round < 24; round++) {
    const said = [f0, f1, f2, f3, f4, f5, f6, f7].map(f => { try { return show(f()); } catch (e) { return e.name; } });
    if (round < 3 || (round > 10 && round < 20) || round === 23) console.log(round, heard, said.join(" "));
}
