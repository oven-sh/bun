let calls = 0; function measure(n: number): number { calls++; return n * 2; }
interface Dial { f0(): number; f1(): number; f2(): number; f3(): number; f4(): number; f5(): number; f6(): number; f7(): number; f8(): number; f9(): number; f10(): number; f11(): number; f12(): number; f13(): number; f14(): number; f15(): number; f16(): number; f17(): number; f18(): number; f19(): number; step: number }
function makeDial(start: number): Dial { let at = start; return { f0: () => ++at, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, f10: () => at + 10, f11: () => at + 11, step: at * 2, f12: () => at + 12, f13: () => at + 13, f14: () => at + 14, f15: () => at + 15, f16: () => at + 16, f17: () => at + 17, f18: () => at + 18, f19: () => at + 19 }; }
const turns = Number(process.argv[2] ?? 3); let sum = 0; let last: Dial = makeDial(0);
for (let i = 0; i < turns; i++) { last = makeDial(i); sum = (sum + Number(last.step)) | 0; }
console.log(calls, sum, String(last.step), last.f0(), last.f19(), last.f10(), Object.keys(last).join());
