"use strict";
let touched = 0, digest = 7, lines = 0;
const shown = [];
function say(name, run) {
    let said;
    try { const r = run(); said = typeof r + ":" + (Array.isArray(r) ? "[" + r.map(String).join() + "]" : String(r)); } catch (error) { said = "threw " + (error).constructor.name; }
    said = name + " " + said.slice(0, 90) + " touched " + touched; lines++;
    for (let c = 0; c < said.length; c++) digest = (digest * 31 + said.charCodeAt(c)) % 1000003;
    shown.push(said);
}
function line(m, xs) { let s = 0; for (let i = 0; i < xs.length; i++) s += m[0] * xs[i] + m[1]; return s; }
function inAnArm(m, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { if (xs[i] > 100) s += m[0]; else s += 1; } return s; }
function behindABreak(m, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { if (xs[i] < 0) break; s += m[2] * xs[i]; } return s; }
function storesThroughAnother(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; o[0] = s; } return s; }
function shrinksThroughAnother(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[1] * xs[i]; if (i === 2) o.length = 0; } return s; }
function growsThroughAnother(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[3] * xs[i]; if (i === 1) o.push(4, 5, 6, 7, 8, 9, 10, 11); } return s; }
function changesKindThroughAnother(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; if (i === 1) o[0] = "7"; if (i === 3) o[0] = { valueOf() { touched++; return 3; } }; } return s; }
function caught(m, xs) { let s = 0, done = -1; try { for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; done = i; if (xs[i] === 13) throw new RangeError("thirteen"); } } catch (error) { return "caught " + (error).constructor.name + " behind " + done + " at " + s; } return "through " + done + " at " + s; }
function put(o, v) { o[0] = v; }
function storesByACallee(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; put(o, s); } return s; }
function storesByAClosure(m, o, xs) { let s = 0; const set = (v) => { o[0] = v; }; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; set(s); } return s; }
function storesInARareArm(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; if (i === 3) o[0] = 9.5; } return s; }
function storesUnderAKey(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i] + m[1]; o[i & 1] = s; } return s; }
function addsOne(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; o[0]++; } return s; }
function swaps(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; [o[0], o[1]] = [o[1], o[0]]; } return s; }
function storesInALoopInside(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; for (let k = 0; k < 2; k++) o[k] = s + k; } return s; }
function fillsByAMethod(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; if (i === 1) o.fill(7.5, 0, 1); } return s; }
function popsByAMethod(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[3] * xs[i]; if (i === 1) o.pop(); } return s; }
function reverses(m, o, xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += m[0] * xs[i]; if (i & 1) o.reverse(); } return s; }
const held = [1.5, 2.5, 3.5];
function bump() { held[0] = held[0] + 1; return 0; }
function callsInTheTurn(xs) { let s = 0; for (let i = 0; i < xs.length; i++) { s += held[0] * xs[i]; if (i & 1) s += bump(); } return s; }
function theLoopAroundStores(m, xs) { let s = 0; for (let k = 0; k < 3; k++) { m[0] = k + 0.5; for (let i = 0; i < xs.length; i++) s += m[0] * xs[i]; } return s; }
function otherKeys(m, xs) { let s = 0; for (let i = 0; i < xs.length; i++) s += (m[-1] === undefined ? 1 : 2) + (m[1.5] === undefined ? 1 : 2) + (m["0"]) * xs[i]; return s; }
function anOperandSpeaks(m, xs) { let s = 0; for (let i = 0; i < xs.length; i++) s += m[0] * (xs[i]); return s; }
function whileLoop(m, n) { let s = 0, i = 0; while (i < n) { s += m[0] + m[1]; i++; } return s; }
function doLoop(m, n) { let s = 0, i = 0; do { s += m[0]; i++; } while (i < n); return s; }
const any = (v) => v;
const xs = () => [1, 2, 3, 4, 5.5], none = () => [];
const makers = [
    ["fractions", () => [0.5, 1.5, 2.5, 3.5]], ["whole", () => [1, 2, 3, 4]],
    ["fractions written", () => { const l = [0.5, 1.5, 2.5, 3.5]; l[3] = 3.25; return l; }], ["whole written", () => { const l = [1, 2, 3, 4]; l[3] = 5; return l; }], ["whole, then a fraction", () => { const l = [1, 2, 3, 4]; l[3] = 4.5; return l; }],
    ["pushed", () => { const l = []; for (let i = 0; i < 4; i++) l.push(i + 0.5); return l; }], ["from", () => Array.from({ length: 4 }, (_, i) => i * 0.5 + 0.25)], ["mapped", () => [1, 2, 3, 4].map(v => v / 2)], ["filled", () => new Array(4).fill(1.5)], ["one", () => [2.5]], ["empty", () => []], ["a hole", () => [, 2.5, , 4.5]], ["nan", () => [NaN, -0, Infinity, 1]],
    ["null", () => null], ["undefined", () => undefined], ["a number", () => 7], ["a text", () => "9876"], ["texts", () => ["2", "3", "4", "5"]], ["big", () => [1n, 2n, 3n, 4n]],
    ["a view", () => new Float64Array([0.5, 1.5, 2.5, 3.5])], ["bytes", () => new Uint8Array([1, 2, 3, 4])], ["frozen", () => Object.freeze([0.5, 1.5, 2.5, 3.5])], ["like a list", () => ({ length: 4, 0: 1.5, 1: 2.5, 2: 3.5, 3: 4.5 })],
    ["a proxy", () => new Proxy([0.5, 1.5, 2.5, 3.5], { get(t, k, r) { touched++; return Reflect.get(t, k, r); } })],
    ["a getter", () => { const l = [0.5, 1.5, 2.5, 3.5]; let n = 0; Object.defineProperty(l, 0, { get() { touched++; return ++n; }, configurable: true }); return l; }],
    ["a getter that throws", () => { const l = [0.5, 1.5, 2.5, 3.5]; let n = 0; Object.defineProperty(l, 0, { get() { touched++; if (++n === 3) throw new EvalError("third"); return n; }, configurable: true }); return l; }],
    ["an heir", () => { class Mine extends Array {} const l = Mine.from([0.5, 1.5, 2.5, 3.5]); return l; }],
    ["above a list", () => Object.setPrototypeOf([, , , ,], [9.5, 8.5, 7.5, 6.5])],
];
for (let round = 0; round < 2; round++) for (const [name, make] of makers) {
    say(name + " line", () => line(any(make()), xs())); say(name + " line, no turn", () => line(any(make()), none()));
    say(name + " arm never taken", () => inAnArm(any(make()), xs())); say(name + " arm taken", () => inAnArm(any(make()), [1, 200, 3, 300]));
    say(name + " break at once", () => behindABreak(any(make()), [-1, 2, 3])); say(name + " break later", () => behindABreak(any(make()), [1, 2, -3, 4]));
    say(name + " stores itself", () => { const m = any(make()); return storesThroughAnother(m, m, xs()); }); say(name + " stores another", () => storesThroughAnother(any(make()), [0, 0], xs()));
    say(name + " shrinks itself", () => { const m = any(make()); return shrinksThroughAnother(m, m, xs()); }); say(name + " grows itself", () => { const m = any(make()); return growsThroughAnother(m, m, xs()); });
    say(name + " storesByACallee itself", () => { const m = any(make()); return storesByACallee(m, m, xs()); }); say(name + " storesByACallee another", () => storesByACallee(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " storesByAClosure itself", () => { const m = any(make()); return storesByAClosure(m, m, xs()); }); say(name + " storesByAClosure another", () => storesByAClosure(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " storesInARareArm itself", () => { const m = any(make()); return storesInARareArm(m, m, xs()); }); say(name + " storesInARareArm another", () => storesInARareArm(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " storesUnderAKey itself", () => { const m = any(make()); return storesUnderAKey(m, m, xs()); }); say(name + " storesUnderAKey another", () => storesUnderAKey(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " addsOne itself", () => { const m = any(make()); return addsOne(m, m, xs()); }); say(name + " addsOne another", () => addsOne(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " swaps itself", () => { const m = any(make()); return swaps(m, m, xs()); }); say(name + " swaps another", () => swaps(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " storesInALoopInside itself", () => { const m = any(make()); return storesInALoopInside(m, m, xs()); }); say(name + " storesInALoopInside another", () => storesInALoopInside(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " fillsByAMethod itself", () => { const m = any(make()); return fillsByAMethod(m, m, xs()); }); say(name + " fillsByAMethod another", () => fillsByAMethod(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " popsByAMethod itself", () => { const m = any(make()); return popsByAMethod(m, m, xs()); }); say(name + " popsByAMethod another", () => popsByAMethod(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " reverses itself", () => { const m = any(make()); return reverses(m, m, xs()); }); say(name + " reverses another", () => reverses(any(make()), [0.25, 0.75, 1.25, 1.75].map(v => v * 2), xs()));
    say(name + " changes kind", () => { const m = any(make()); return changesKindThroughAnother(m, m, xs()); });
    say(name + " caught", () => caught(any(make()), [1, 2, 13, 4])); say(name + " not thrown", () => caught(any(make()), xs())); say(name + " caught, no turn", () => caught(any(make()), none()));
    say(name + " around", () => theLoopAroundStores(any(make()), xs())); say(name + " other keys", () => otherKeys(any(make()), xs()));
    say(name + " an operand speaks", () => { const m = any(make()); return anOperandSpeaks(m, [1, { valueOf() { touched++; if (m && typeof m === "object") m[0] = 100; return 2; } }, 3, 4]); });
    say(name + " while", () => whileLoop(any(make()), 4)); say(name + " while, no turn", () => whileLoop(any(make()), 0)); say(name + " do", () => doLoop(any(make()), 3)); say(name + " do, once", () => doLoop(any(make()), 0));
}
say("calls in the turn", () => callsInTheTurn(xs())); say("calls in the turn again", () => callsInTheTurn(xs())); say("held", () => held);
console.log(lines, digest, touched); console.log(shown.filter((_, i) => i % 7 === 0).join("\n"));
