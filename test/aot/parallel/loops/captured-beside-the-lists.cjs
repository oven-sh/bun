"use strict";
function scaled(a, b, k) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i] * k; return s; }
function through(a, b, g) { let s = 0; for (let i = 0; i < 3; i++) s += g(a[i] * b[i]); return s; }
function held(a, b, o) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i]; return s + (o ? o.more : 0); }
let made = 0;
function outer(k) {
    const a = [0.5, 1.5, 2.5].map(v => v * k), b = [1, 2, 3].map(v => v / 2), scale = k * 1.5, twice = v => v * 2, record = { get more() { made++; return 0.25; } };
    return [
        turns => { let s = 0; for (let i = 0; i < turns; i++) s += scaled(a, b, scale); return s; },
        turns => { let s = 0; for (let i = 0; i < turns; i++) s += through(a, b, twice); return s; },
        turns => { let s = 0; for (let i = 0; i < turns; i++) s += held(a, b, record); return s; },
    ];
}
const out = [];
for (const k of [1, 2.5]) for (const run of outer(k)) for (const turns of [0, 1, 5]) out.push(run(turns));
console.log(out.join(" | "), made);
