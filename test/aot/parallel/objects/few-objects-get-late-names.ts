// A few of many objects get other names in one function: the many need no room for them.
const N = 50000, few = 3;
function heap(): number { Bun.gc(true); return process.memoryUsage().heapUsed; }
class P { a: number; constructor(a: number) { this.a = a; } }
class Holder { o: any; constructor(o: any) { this.o = o; } }
const literals: any[] = [], instances: any[] = [], answers: any[] = [], held: any[] = [];
const said: string[] = [];
function fillLiterals() { for (let i = 0; i < few; i++) { const o = literals[i % literals.length]; o.f0 = i; o.f1 = i; o.f2 = i; o.f3 = i; o.f4 = i; o.f5 = i; o.f6 = i; o.f7 = i; o.f8 = i; o.f9 = i; o.f10 = i; o.f11 = i; o.f12 = i; o.f13 = i; o.f14 = i; o.f15 = i; o.f16 = i; o.f17 = i; o.f18 = i; o.f19 = i; o.f20 = i; o.f21 = i; o.f22 = i; o.f23 = i; o.f24 = i; o.f25 = i; o.f26 = i; o.f27 = i; o.f28 = i; o.f29 = i; o.f30 = i; o.f31 = i; o.f32 = i; o.f33 = i; o.f34 = i; o.f35 = i; o.f36 = i; o.f37 = i; o.f38 = i; o.f39 = i; } }
function fillInstances() { for (let i = 0; i < few; i++) { const o = instances[i % instances.length]; o.f0 = i; o.f1 = i; o.f2 = i; o.f3 = i; o.f4 = i; o.f5 = i; o.f6 = i; o.f7 = i; o.f8 = i; o.f9 = i; o.f10 = i; o.f11 = i; o.f12 = i; o.f13 = i; o.f14 = i; o.f15 = i; o.f16 = i; o.f17 = i; o.f18 = i; o.f19 = i; o.f20 = i; o.f21 = i; o.f22 = i; o.f23 = i; o.f24 = i; o.f25 = i; o.f26 = i; o.f27 = i; o.f28 = i; o.f29 = i; o.f30 = i; o.f31 = i; o.f32 = i; o.f33 = i; o.f34 = i; o.f35 = i; o.f36 = i; o.f37 = i; o.f38 = i; o.f39 = i; } }
function at(list: any[], i: number): any { return list[i]; }
function fillAnswers() { for (let i = 0; i < few; i++) { const o = at(answers, i); o.f0 = i; o.f1 = i; o.f2 = i; o.f3 = i; o.f4 = i; o.f5 = i; o.f6 = i; o.f7 = i; o.f8 = i; o.f9 = i; o.f10 = i; o.f11 = i; o.f12 = i; o.f13 = i; o.f14 = i; o.f15 = i; o.f16 = i; o.f17 = i; o.f18 = i; o.f19 = i; o.f20 = i; o.f21 = i; o.f22 = i; o.f23 = i; o.f24 = i; o.f25 = i; o.f26 = i; o.f27 = i; o.f28 = i; o.f29 = i; o.f30 = i; o.f31 = i; o.f32 = i; o.f33 = i; o.f34 = i; o.f35 = i; o.f36 = i; o.f37 = i; o.f38 = i; o.f39 = i; } }
function fillHeld(h: any, i: number) { const o = h.o; o.f0 = i; o.f1 = i; o.f2 = i; o.f3 = i; o.f4 = i; o.f5 = i; o.f6 = i; o.f7 = i; o.f8 = i; o.f9 = i; o.f10 = i; o.f11 = i; o.f12 = i; o.f13 = i; o.f14 = i; o.f15 = i; o.f16 = i; o.f17 = i; o.f18 = i; o.f19 = i; o.f20 = i; o.f21 = i; o.f22 = i; o.f23 = i; o.f24 = i; o.f25 = i; o.f26 = i; o.f27 = i; o.f28 = i; o.f29 = i; o.f30 = i; o.f31 = i; o.f32 = i; o.f33 = i; o.f34 = i; o.f35 = i; o.f36 = i; o.f37 = i; o.f38 = i; o.f39 = i; }
function check(name: string, make: () => void, fill: () => void) { const before = heap(); make(); fill(); said.push(name + (heap() - before < 7e6 ? " small" : " large")); }
check("literals", () => { for (let i = 0; i < N; i++) literals.push({ a: i }); }, fillLiterals);
check("instances", () => { for (let i = 0; i < N; i++) instances.push(new P(i)); }, fillInstances);
check("answers", () => { for (let i = 0; i < N; i++) answers.push({ b: i }); }, fillAnswers);
check("held", () => { for (let i = 0; i < N; i++) held.push(new Holder({ c: i })); }, () => { for (let i = 0; i < few; i++) fillHeld(held[i * 7], i); });
console.log(said.join(), literals[1].f39, instances[2].f0, answers[0].f7, held[7].o.f3, Object.keys(literals[2]).length, literals.length + instances.length + answers.length + held.length);
