// Evaluated text that stores into properties that compiled objects have beside their fields.
"use strict";
const lines = [], say = (...words) => lines.push(words.map(w => typeof w === "string" ? w : JSON.stringify(w)).join(" "));
const unknown = process.argv.length > 90 ? "return;" : "", hide = v => [v, 0][process.argv.length > 90 ? 1 : 0];
const made = (...words) => new Function(...words.slice(0, -1), unknown + words[words.length - 1]);
const set = made("o", "v", "o.path = v; return o.path;"), setFour = made("o", "v", "o.path = v; o.next = [v]; o.third = v; o.fourth = { v }; return o;");
const shapes = hide([i => ({ code: "a", input: i }), i => ({ code: "b", values: ["x", i], inst: null }), i => ({ code: "c", input: "y", inst: null, pattern: "p" + i }), () => ({})]);
const add = hide((o, v) => { o.path = v; return o; }), addMore = hide(o => { o.next = 1; o.third = 2; o.fourth = 3; o.fifth = 4; return o; });
const values = hide([1, -0, 0.5, "s", null, undefined, true, { v: 1 }, [1, 2], 2147483648, NaN]);
for (let turn = 0; turn < 4; turn++) for (const make of shapes) for (const v of values) {
    const o = add(make(turn), 0); const answer = set(o, v); say(turn, o, Object.keys(o), Object.is(answer, v));
}
for (let turn = 0; turn < 40; turn++) { const o = addMore(add(shapes[turn % 4](turn), "first")); setFour(o, turn); say(turn, o); setFour(o, "t" + turn); say(o.third, o.fourth, Object.keys(o).join()); }
let hits = 0; for (let i = 0; i < 4000; i++) { const o = add(shapes[i & 3](i), 0); set(o, i); hits += o.path; set(o, "s"); hits += o.path.length; } say("hits", hits);
// An old object that gets a young value, and is asked after collections.
const old = []; for (let i = 0; i < 200; i++) old.push(addMore(add(shapes[i % 4](i), "o")));
if (globalThis.Bun) Bun.gc(true);
for (let turn = 0; turn < 6; turn++) { for (let i = 0; i < old.length; i++) { set(old[i], { turn, i, text: "t" + i }); setFour(old[i], { at: i * turn }); } if (globalThis.Bun) Bun.gc(turn % 2 === 0); let bad = 0; for (let i = 0; i < old.length; i++) if (old[i].path.at !== i * turn || old[i].next[0].at !== i * turn || old[i].fourth.v.at !== i * turn) bad++; say("old", turn, bad, old[7]); }
const inLoop = made("list", "for (const iss of list) { iss.path = iss.path ? ['k', ...iss.path] : ['k']; } return list;"); for (let turn = 0; turn < 400; turn++) { const list = [add(shapes[0](1), ["a"]), shapes[1](2), add(shapes[2](3), ["b", 1])]; inLoop(list); const all = inLoop(list).map(o => o.path.join(".")); if (turn % 50 === 0) say(list, all); }
console.log(lines.join("\n"));
