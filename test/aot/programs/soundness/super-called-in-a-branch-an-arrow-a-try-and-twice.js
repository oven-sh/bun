// Super() in odd places.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
class P { constructor() { this.pa = { qd: 1 }; } }
class Q1 extends P { qa = { qd: 2 }; constructor(k) { if (k) super(); else super(); seen.push(this.qa.qd); } }
new Q1(0); new Q1(1);
class Q2 extends P { qb = { qd: 3 }; constructor() { const s = () => super(); s(); seen.push(this.qb.qd); } }
new Q2();
class Q3 extends P { qc = { qd: 4 }; constructor() { try { super(); mayThrow(); } catch {} finally { seen.push(attempt(() => this.qc.qd)); } } }
new Q3();
class Q4 extends P { qe = { qd: 5 }; constructor() { super(); seen.push(attempt(() => super())); seen.push(this.qe.qd); } }
attempt(() => new Q4());
let early; class Q5 extends P { qf = (early = this, mayThrow(), { qd: 6 }); qg = { qd: 7 }; constructor() { try { super(); } catch {} seen.push(attempt(() => this.qg.qd)); } }
attempt(() => new Q5());
console.log(seen.join("|"), attempt(() => early.qf.qd), attempt(() => early.qg.qd), attempt(() => early.pa.qd));
class Q6 extends P { qh = { qd: 8 }; constructor() { const f = () => this.qh.qd; seen.push(attempt(f)); super(); seen.push(attempt(f)); } }
new Q6();
console.log(seen.join("|"));
