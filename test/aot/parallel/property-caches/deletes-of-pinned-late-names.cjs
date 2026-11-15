"use strict";
// A name that came late is deleted and defined again as not configurable: a deletion throws, at a warm site too.
class Q { constructor(i) { this.a = i; } }
function make(i) { const o = new Q(i); o.late = i; return o; }
const before = o => { delete o.late; }, remove = o => delete o.late, pin = o => { Object.defineProperty(o, "late", { value: 5 }); };
let deleted = 0, there = 0, refused = 0;
for (let i = 0; i < 400; i++) {
    const o = make(i); before(o);
    if (i % 3 === 0) { pin(o); try { remove(o); deleted++; if (Object.hasOwn(o, "late")) there++; } catch (e) { if (e instanceof TypeError) refused++; } }
}
console.log(deleted, there, refused);
