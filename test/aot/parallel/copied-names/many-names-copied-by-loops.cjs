// STATISTIC: ListedValuesStoredByName <= 60
// STATISTIC: InstanceNamesReadByLoops <= 120
// A copy of many names is told of all of them, not once for each.
const out = [];
class Options { constructor(o) { Object.assign(this, o); } get first() { return this.a; } }
function Table() { this.a = 1; this.late = null; }
Table.prototype.size = function () { return Object.keys(this).length; };
function copy(o) { const r = {}; for (const k in o) r[k] = o[k]; return r; }
function clone(o) { const r = Object.create(Object.getPrototypeOf(o)); for (const k in o) r[k] = o[k]; return r; }
function own(o) { const r = {}; for (const k in o) if (Object.hasOwn(o, k)) r[k] = o[k]; return r; }
function sum(o) { let s = 0; for (const k in o) if (typeof o[k] === "number") s += o[k]; return s; }
function fill(t, o) { for (const k in o) t[k] = o[k]; return t; }
for (let i = 0; i < 20; i++) {
    const numbers = { a: i, k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9, k10: 10, k11: 11, k12: 12, k13: 13, k14: 14, k15: 15, k16: 16, k17: 17, k18: 18, k19: 19, k20: 20, k21: 21, k22: 22, k23: 23, k24: 24, k25: 25, k26: 26, k27: 27, k28: 28, k29: 29, k30: 30, k31: 31, k32: 32, k33: 33, k34: 34, k35: 35, k36: 36, k37: 37, k38: 38, k39: 39 }, texts = { a: i, q0: "q0", q1: "q1", q2: "q2", q3: "q3", q4: "q4", q5: "q5", q6: "q6", q7: "q7", q8: "q8", q9: "q9", q10: "q10", q11: "q11", q12: "q12", q13: "q13", q14: "q14", q15: "q15", q16: "q16", q17: "q17", q18: "q18", q19: "q19", q20: "q20", q21: "q21", q22: "q22", q23: "q23", q24: "q24", q25: "q25", q26: "q26", q27: "q27", q28: "q28", q29: "q29", q30: "q30", q31: "q31", q32: "q32", q33: "q33", q34: "q34", q35: "q35", q36: "q36", q37: "q37", q38: "q38", q39: "q39" };
    const one = copy(i & 1 ? numbers : texts), two = clone(i & 1 ? { a: 1, k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9, k10: 10, k11: 11, k12: 12, k13: 13, k14: 14, k15: 15, k16: 16, k17: 17, k18: 18, k19: 19, k20: 20, k21: 21, k22: 22, k23: 23, k24: 24, k25: 25, k26: 26, k27: 27, k28: 28, k29: 29, k30: 30, k31: 31, k32: 32, k33: 33, k34: 34, k35: 35, k36: 36, k37: 37, k38: 38, k39: 39 } : { a: 2, b: 3 });
    const options = new Options({ a: i, k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9, k10: 10, k11: 11, k12: 12, k13: 13, k14: 14, k15: 15, k16: 16, k17: 17, k18: 18, k19: 19, k20: 20, k21: 21, k22: 22, k23: 23, k24: 24, k25: 25, k26: 26, k27: 27, k28: 28, k29: 29, k30: 30, k31: 31, k32: 32, k33: 33, k34: 34, k35: 35, k36: 36, k37: 37, k38: 38, k39: 39 }), three = own(options);
    if (i % 3 === 1) options.z = i;
    const four = own(options), table = fill(new Table(), i & 2 ? numbers : { a: 5, c: i });
    if (i % 5 === 4) delete three.k1;
    out.push(one.k7, one.q7, two.k9, two.b, three.k1, three.z, four.z, table.k3, table.c, table.size(), sum(options), sum(three), options.first, Object.keys(one).length, Object.keys(two).length, Object.keys(three).length, Object.keys(four).join().length);
}
console.log(out.map(String).join(" "));
