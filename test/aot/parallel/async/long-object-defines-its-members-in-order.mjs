// An object of more than 32 computed members in a function that suspends: the order of its keys, the later of two members of one name, accessors, methods, spreads, computed keys, __proto__ and index keys.
await null;
let log = "";
const note = value => { log += value + " "; return value; };
const show = object => Object.keys(object).length + ":" + Object.keys(object).slice(0, 3).join(",") + ".." + Object.keys(object).slice(-6).join(",");

const plain = { k0: note(0), k1: note(1), k2: note(2), k3: note(3), k4: note(4), k5: note(5), k6: note(6), k7: note(7), k8: note(8), k9: note(9), k10: note(10), k11: note(11), k12: note(12), k13: note(13), k14: note(14), k15: note(15), k16: note(16), k17: note(17), k18: note(18), k19: note(19), k20: note(20), k21: note(21), k22: note(22), k23: note(23), k24: note(24), k25: note(25), k26: note(26), k27: note(27), k28: note(28), k29: note(29), k30: note(30), k31: note(31), k32: note(32), k33: note(33), k34: note(34), k35: note(35), k36: note(36), k37: note(37), k38: note(38), k39: note(39) };
console.log(log.length, show(plain), plain.k0, plain.k31, plain.k32, plain.k39);

const twice = { k0: note(0), k1: note(1), k2: note(2), k3: note(3), k4: note(4), k5: note(5), k6: note(6), k7: note(7), k8: note(8), k9: note(9), k10: note(10), k11: note(11), k12: note(12), k13: note(13), k14: note(14), k15: note(15), k16: note(16), k17: note(17), k18: note(18), k19: note(19), k20: note(20), k21: note(21), k22: note(22), k23: note(23), k24: note(24), k25: note(25), k26: note(26), k27: note(27), k28: note(28), k29: note(29), k30: note(30), k31: note(31), k32: note(32), k33: note(33), k34: note(34), k35: note(35), k36: note(36), k37: note(37), k38: note(38), k39: note(39), k1: note("again 1"), k35: note("again 35"), k36: note("again 36") };
console.log(show(twice), twice.k1, twice.k35, twice.k36);

const base = { inherited: "from base", k34: "hidden" };
const source = { s1: 1, k33: "from the spread", s2: 2 };
let written = "";
const mixed = {
  k0: note(0), k1: note(1), k2: note(2), k3: note(3), k4: note(4), k5: note(5), k6: note(6), k7: note(7), k8: note(8), k9: note(9), k10: note(10), k11: note(11), k12: note(12), k13: note(13), k14: note(14), k15: note(15), k16: note(16), k17: note(17), k18: note(18), k19: note(19), k20: note(20), k21: note(21), k22: note(22), k23: note(23), k24: note(24), k25: note(25), k26: note(26), k27: note(27), k28: note(28), k29: note(29), k30: note(30), k31: note(31), k32: note(32), k33: note(33),
  get reader() { return "read " + this.k2; },
  set writer(value) { written = value + this.k33; },
  method() { return "method " + this.k38; },
  ...note(source),
  [note("computed")]: note("c"),
  __proto__: note(base),
  k34: note(34), k35: note(35), k36: note(36), k37: note(37), k38: note(38), k39: note(39),
  ["k" + 3]: note("computed again 3"),
  async later() { return this.k39; },
  *steps() { yield this.k36; },
};
mixed.writer = "wrote ";
console.log(show(mixed), mixed.reader, written, mixed.method(), mixed.inherited, mixed.k34, mixed.k3, mixed.k33, await mixed.later(), [...mixed.steps()][0]);
console.log(Object.getPrototypeOf(mixed) === base, JSON.stringify(Object.getOwnPropertyDescriptor(mixed, "k38")), typeof Object.getOwnPropertyDescriptor(mixed, "reader").get);

log = "";
const indexes = { last: note("last"), 39: note(39), 38: note(38), 37: note(37), 36: note(36), 35: note(35), 34: note(34), 33: note(33), 32: note(32), 31: note(31), 30: note(30), 29: note(29), 28: note(28), 27: note(27), 26: note(26), 25: note(25), 24: note(24), 23: note(23), 22: note(22), 21: note(21), 20: note(20), 19: note(19), 18: note(18), 17: note(17), 16: note(16), 15: note(15), 14: note(14), 13: note(13), 12: note(12), 11: note(11), 10: note(10), 9: note(9), 8: note(8), 7: note(7), 6: note(6), 5: note(5), 4: note(4), 3: note(3), 2: note(2), 1: note(1), 0: note(0), first: note("first"), 2: note("two again") };
console.log(log.slice(0, 20), Object.keys(indexes).slice(0, 4).join(","), Object.keys(indexes).slice(-3).join(","), indexes[2], indexes[39], Object.keys(indexes).length);

log = "";
try {
  const thrown = { k0: note(0), k1: note(1), k2: note(2), k3: note(3), k4: note(4), k5: note(5), k6: note(6), k7: note(7), k8: note(8), k9: note(9), k10: note(10), k11: note(11), k12: note(12), k13: note(13), k14: note(14), k15: note(15), k16: note(16), k17: note(17), k18: note(18), k19: note(19), k20: note(20), k21: note(21), k22: note(22), k23: note(23), k24: note(24), k25: note(25), k26: note(26), k27: note(27), k28: note(28), k29: note(29), k30: note(30), k31: note(31), k32: note(32), k33: note(33), k34: note(34), k35: (() => { throw new Error("at 35"); })(), k36: note(36), k37: note(37), k38: note(38), k39: note(39) };
  console.log("not reached", thrown);
} catch (error) {
  console.log(error.message, log.slice(-9));
}

// Each key is converted behind every expression of the list.
log = "";
const keyOf = index => ({ toString() { log += "key" + index + " "; return "k" + index; } });
const entries = Object.fromEntries([[keyOf(0), note(0)], [keyOf(1), note(1)], [keyOf(2), note(2)], [keyOf(3), note(3)], [keyOf(4), note(4)], [keyOf(5), note(5)], [keyOf(6), note(6)], [keyOf(7), note(7)], [keyOf(8), note(8)], [keyOf(9), note(9)], [keyOf(10), note(10)], [keyOf(11), note(11)], [keyOf(12), note(12)], [keyOf(13), note(13)], [keyOf(14), note(14)], [keyOf(15), note(15)], [keyOf(16), note(16)], [keyOf(17), note(17)], [keyOf(18), note(18)], [keyOf(19), note(19)], [keyOf(20), note(20)], [keyOf(21), note(21)], [keyOf(22), note(22)], [keyOf(23), note(23)], [keyOf(24), note(24)], [keyOf(25), note(25)], [keyOf(26), note(26)], [keyOf(27), note(27)], [keyOf(28), note(28)], [keyOf(29), note(29)], [keyOf(30), note(30)], [keyOf(31), note(31)], [keyOf(32), note(32)], [keyOf(33), note(33)], [keyOf(34), note(34)], [keyOf(35), note(35)], [keyOf(36), note(36)], [keyOf(37), note(37)], [keyOf(38), note(38)], [keyOf(39), note(39)]]);
console.log(log.slice(0, 24), "|", log.slice(-24), show(entries), entries.k39);
const named = Object.fromEntries([["k0", () => 0], ["k1", () => 1], ["k2", () => 2], ["k3", () => 3], ["k4", () => 4], ["k5", () => 5], ["k6", () => 6], ["k7", () => 7], ["k8", () => 8], ["k9", () => 9], ["k10", () => 10], ["k11", () => 11], ["k12", () => 12], ["k13", () => 13], ["k14", () => 14], ["k15", () => 15], ["k16", () => 16], ["k17", () => 17], ["k18", () => 18], ["k19", () => 19], ["k20", () => 20], ["k21", () => 21], ["k22", () => 22], ["k23", () => 23], ["k24", () => 24], ["k25", () => 25], ["k26", () => 26], ["k27", () => 27], ["k28", () => 28], ["k29", () => 29], ["k30", () => 30], ["k31", () => 31], ["k32", () => 32], ["k33", () => 33], ["k34", () => 34], ["k35", () => 35], ["k36", () => 36], ["k1", () => 37], ["k38", () => 38], ["k39", () => 39]]);
console.log(show(named), named.k35(), named.k1());

async function waits() {
  const made = { k0: await 0, k1: await 1, k2: await 2, k3: await 3, k4: await 4, k5: await 5, k6: await 6, k7: await 7, k8: await 8, k9: await 9, k10: await 10, k11: await 11, k12: await 12, k13: await 13, k14: await 14, k15: await 15, k16: await 16, k17: await 17, k18: await 18, k19: await 19, k20: await 20, k21: await 21, k22: await 22, k23: await 23, k24: await 24, k25: await 25, k26: await 26, k27: await 27, k28: await 28, k29: await 29, k30: await 30, k31: await 31, k32: await 32, k33: await 33, k34: await 34, k35: await 35, k36: await 36, k37: await 37, k38: await 38, k39: await 39 };
  return show(made) + made.k39;
}
function* yields() {
  const made = { k0: yield 0, k1: yield 1, k2: yield 2, k3: yield 3, k4: yield 4, k5: yield 5, k6: yield 6, k7: yield 7, k8: yield 8, k9: yield 9, k10: yield 10, k11: yield 11, k12: yield 12, k13: yield 13, k14: yield 14, k15: yield 15, k16: yield 16, k17: yield 17, k18: yield 18, k19: yield 19, k20: yield 20, k21: yield 21, k22: yield 22, k23: yield 23, k24: yield 24, k25: yield 25, k26: yield 26, k27: yield 27, k28: yield 28, k29: yield 29, k30: yield 30, k31: yield 31, k32: yield 32, k33: yield 33, k34: yield 34, k35: yield 35, k36: yield 36, k37: yield 37, k38: yield 38, k39: yield 39 };
  return show(made) + made.k39;
}
console.log(await waits());
const steps = yields();
let step = steps.next(), sent = 0;
while (!step.done) step = steps.next(sent++);
console.log(step.value);
