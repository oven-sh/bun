"use strict";
// A callee that is one function or undefined, called in every iteration: the check for it stands before the loop.
const say = (...values) => console.log(values.map(String).join(" "));
let calls = 0;
const lib = {}; (function (exports) { function add(a, b) { return a + b; } exports.add = add; })(lib);
const empty = {}; (function (exports) { function add(a, b) { return a + b; } if (JSON.parse("false")) exports.add = add; })(empty);
const counting = {}; (function (exports) { function step(a, b) { calls++; return a + b; } exports.step = step; })(counting);
const throwing = {}; (function (exports) { function check(a, b) { if (b === 4) throw new RangeError("four"); return a + b; } exports.check = check; })(throwing);
const leaving = {}; (function (exports) { function add(a, b) { return a * 2 + b; } exports.add = add; })(leaving);
const taken = {}; (function (exports) { function add(a, b) { return a - b; } exports.add = add; })(taken);
const T = {
    sum(t, n) { let s = t & 7; for (let i = 0; i < n; i++) s = lib.add(s, i); return s; },
    fixed(t) { let s = t & 7; for (let i = 0; i < 2000; i++) s = lib.add(s, i); return s; },
    none(t, n) { let s = t & 7; for (let i = 0; i < n; i++) s = empty.add(s, i); return s; },
    count(t, n) { let s = t & 7; for (let i = 0; i < n; i++) s = counting.step(s, i); return s; },
    caught(t, n) { let s = t & 7; for (let i = 0; i < n; i++) { try { s = throwing.check(s, i); } catch (error) { s = s + 100; } } return s; },
    thrown(t, n) { let s = t & 7; for (let i = 0; i < n; i++) s = throwing.check(s, i); return s; },
    leaves(t, n) { let s = t & 7; for (let i = 0; i < n; i++) { s = leaving.add(s, i); if (i === t) leaving.add = undefined; } return s; },
    removed(t, n) { let s = t & 7; for (let i = 0; i < n; i++) { s = taken.add(s, i); if (i === t) delete taken.add; } return s; },
    nested(t, n) { let s = t & 7; for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) s = lib.add(s, j); return s; },
    sometimes(t, n) { let s = t & 7; for (let i = 0; i < n; i++) if (i & 1) s = lib.add(s, i); return s; },
};
function run(name, ...values) { const key = JSON.parse(JSON.stringify(name)); try { say(name, T[key](...values), calls); } catch (error) { say(name, error instanceof TypeError ? "TypeError" : error.message, calls); } }
for (let round = 0; round < 3; round++) {
    for (const n of [0, 1, 9]) { run("sum", round, n); run("none", round, n); run("count", round, n); run("caught", round, n); run("thrown", round, n); run("nested", round, n); run("sometimes", round, n); }
    run("fixed", round);
}
run("leaves", 20, 9); run("leaves", 3, 9); run("leaves", 3, 9); run("leaves", 3, 0);
run("removed", 20, 9); run("removed", 2, 9); run("removed", 2, 9);
lib.add = (a, b) => a * b; run("sum", 1, 5); run("nested", 1, 2);
lib.add = undefined; run("sum", 1, 0); run("sum", 1, 5); run("fixed", 1); run("sometimes", 1, 1); run("sometimes", 1, 2);
Object.defineProperty(lib, "add", { get() { calls += 10; return (a, b) => a + b + 1; } }); run("sum", 1, 5);
empty.add = (a, b) => a + b + 2; run("none", 1, 5);
