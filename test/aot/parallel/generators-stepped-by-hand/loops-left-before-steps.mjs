// A loop that is left before its first step has still called the generator function: parameters are bound, patterns may throw.
let bound = 0;
function* ofDefault(x = (bound += 1)) { yield x; yield x + 1; }
function* ofObject({ v }) { yield v; }
function* ofPair([a, b]) { yield a; yield b; }
function* plain(x) { bound += 1000; yield x; }
function whileTrue(go) { let t = 0; const it = ofDefault(); while (go) { const r = it.next(); if (r.done) break; t += r.value; } return t; }
function until(stop) { let t = 0; const it = ofDefault(); for (;;) { if (stop) break; const r = it.next(); if (r.done) break; t += r.value; } return t; }
function unequal(n) { let t = 0, k = 0; const it = ofDefault(); while (k !== n) { const { value, done } = it.next(); if (done) break; t += value; k++; } return t; }
function objects(go, o) { let t = 0; const it = ofObject(o); while (go) { const r = it.next(); if (r.done) break; t += r.value; } return t; }
function pairs(go, o) { let t = 0; const it = ofPair(o); while (go) { const r = it.next(); if (r.done) break; t += r.value; } return t; }
function none(go) { let t = 0; const it = plain(1); while (go) { const r = it.next(); if (r.done) break; t += r.value; } return t; }
const got = [];
for (const go of [true, false, true, false]) {
    got.push(whileTrue(go), bound, until(!go), bound, unequal(go ? 2 : 0), bound, none(go), bound);
    for (const f of [objects, pairs]) {
        for (const o of [{ v: 3 }, [1, 2], null, undefined]) {
            try { got.push(f(go, o)); } catch (error) { got.push(error.name); }
        }
    }
}
let sum = 0;
for (let i = 0; i < 60; i++) sum += whileTrue(i % 3 === 0) + until(i % 5 === 0) + unequal(i % 4);
got.push(sum, bound);
console.log(got.join());
