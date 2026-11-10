"use strict";
const log = [];
const outside = JSON.parse('[[1, 2, 3], [1.5, 2.5, 3.5], ["a", "b", "c"], [1, "b", 2.5], [null, true, {"k": 1}]]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } };
const make = () => ({ tag: 1 }); const all = [];
for (const list of outside) { const r = make(); for (let i = 0; i < list.length; i++) r[i] = list[i]; all.push(r); }
const sparse = make(); sparse[0] = "a"; sparse[100000] = "far"; all.push(sparse); const holed = make(); holed[0] = 1; holed[2] = 3; all.push(holed); const none = make(); all.push(none);
const got = make(); got[0] = 1; Object.defineProperty(got, 1, { get() { log.push("got"); return 41; }, configurable: true }); got[2] = 3; all.push(got);
const gone = make(); gone[0] = 1; gone[1] = 2; gone[2] = 3; delete gone[1]; all.push(gone);
function read(t, i) { const r = all[t]; return r[i | 0]; }
for (let t = 0; t < all.length; t++) for (let i = 0; i < 4; i++) say(read(t, i)); say(read(5, 100000));
for (const key of [1.5, -0, "1", "01", NaN, 4294967295, 4294967294, 2147483648, true, null, undefined]) { const r = all[0]; say(r[key]); }
console.log("SAID", log.join(" | "));
