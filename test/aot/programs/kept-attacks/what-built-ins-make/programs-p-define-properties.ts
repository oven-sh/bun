// What built ins make: programs p define properties. It prints what plain Bun prints.
// @ts-nocheck
// Instructions a property of Object.getOwnPropertyDescriptors(b) and of Object.defineProperties(target, descriptors), by the sort of target.
const what = process.argv[2];
const size = 40, rounds = 5000 * Number(process.env.TIMES ?? 1);
const make = () => { const o = {}; for (let i = 0; i < size; i++) o["name" + i] = i % 2 ? i : () => i; return o; };
const a = { first: 1, second: "two", third: () => 3 };
const b = make();
const literal = { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8, p9: 9, p10: 0, p11: 1, p12: 2, p13: 3, p14: 4, p15: 5, p16: 6, p17: 7, p18: 8, p19: 9, p20: 0, p21: 1, p22: 2, p23: 3, p24: 4, p25: 5, p26: 6, p27: 7, p28: 8, p29: 9, p30: 0, p31: 1, p32: 2, p33: 3, p34: 4, p35: 5, p36: 6, p37: 7, p38: 8, p39: 9 };
const fixed = Object.getOwnPropertyDescriptors(b);
let kept = 0;
for (let round = 0; round < rounds; round++) {
  if (what === "descriptors") kept += Object.getOwnPropertyDescriptors(b).name1.value;
  else if (what === "descriptors-of-literal") kept += Object.getOwnPropertyDescriptors(literal).p1.value;
  else if (what === "define-on-empty") kept += Object.defineProperties({}, fixed).name1;
  else if (what === "define-on-spread") kept += Object.defineProperties({ ...a, k: () => round }, fixed).name1;
  else if (what === "idiom-on-spread") kept += Object.defineProperties({ ...a, k: () => round }, Object.getOwnPropertyDescriptors(b)).name1;
  else if (what === "idiom-on-empty") kept += Object.defineProperties({}, Object.getOwnPropertyDescriptors(b)).name1;
  else if (what === "idiom-then-assign") kept += Object.assign(Object.defineProperties({ ...a, k: () => round }, Object.getOwnPropertyDescriptors(b)), a).name1;
  else if (what === "idiom-of-literal") kept += Object.defineProperties({ ...a, k: () => round }, Object.getOwnPropertyDescriptors(literal)).p1;
  else if (what === "spread-alone") kept += { ...a, k: () => round }.first;
  else if (what === "define-on-literal") kept += Object.defineProperties({ first: 1, k: () => round }, fixed).name1;
  else if (what === "assign-on-empty") kept += Object.assign({}, b).name1;
  else if (what === "spread-of-b") kept += { ...b }.name1;
  else kept += 1;
}
console.log(kept);
