// Methods of many lengths taken off their objects and called without `this`, with null, with a number, with another object: a TypeError or an answer, and no object is touched that was not `this`.
// The code of such a method may end in the call that throws. Whatever its length, the throw belongs to that method and not to the function laid out after it.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const lines: string[] = [];
class C0 { a = 1.5; b = 2.5; n = 0; s = "s"; on = false; run(): number { this.a += this.b; return this.a } }
class C1 { a = 1.5; b = 2.5; n = 1; s = "s"; on = false; run(): number { this.a += 1; return this.a } }
class C2 { a = 1.5; b = 2.5; n = 2; s = "s"; on = false; run(): number { this.a = this.a + this.b + 1; return this.a } }
class C3 { a = 1.5; b = 2.5; n = 3; s = "s"; on = false; run(): number { this.a -= this.b; this.b += 2; return this.a } }
class C4 { a = 1.5; b = 2.5; n = 4; s = "s"; on = false; run(): number { return this.a } }
class C5 { a = 1.5; b = 2.5; n = 5; s = "s"; on = false; run(): number { return this.a * this.b } }
class C6 { a = 1.5; b = 2.5; n = 6; s = "s"; on = false; run(): number { this.b = this.a; return this.b } }
class C7 { a = 1.5; b = 2.5; n = 7; s = "s"; on = false; run(): number { this.a = -this.a; return this.a + this.b } }
class C8 { a = 1.5; b = 2.5; n = 8; s = "s"; on = false; run(): number { this.a += this.b; this.a += this.b; return this.a } }
class C9 { a = 1.5; b = 2.5; n = 9; s = "s"; on = false; run(): number { this.a = this.b * 3; return this.a - 1 } }
class C10 { a = 1.5; b = 2.5; n = 10; s = "s"; on = false; run(): number { if (this.a > this.b) this.a = 0; return this.a } }
class C11 { a = 1.5; b = 2.5; n = 11; s = "s"; on = false; run(): number { this.n++; return this.n } }
class C12 { a = 1.5; b = 2.5; n = 12; s = "s"; on = false; run(): number { this.n += 3; this.a += this.n; return this.a } }
class C13 { a = 1.5; b = 2.5; n = 13; s = "s"; on = false; run(): string { return this.s + this.n } }
class C14 { a = 1.5; b = 2.5; n = 14; s = "s"; on = false; run(): number { this.s += "x"; return this.s.length } }
class C15 { a = 1.5; b = 2.5; n = 15; s = "s"; on = false; run(): number { this.on = !this.on; return this.on ? 1 : 0 } }
const made = [new C0(), new C1(), new C2(), new C3(), new C4(), new C5(), new C6(), new C7(), new C8(), new C9(), new C10(), new C11(), new C12(), new C13(), new C14(), new C15()] as const;
{ const o = made[0], run = o.run; const list: (() => unknown)[] = [run]; lines.push([0, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C0())), JSON.stringify(o)].join(" ")); }
{ const o = made[1], run = o.run; const list: (() => unknown)[] = [run]; lines.push([1, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C1())), JSON.stringify(o)].join(" ")); }
{ const o = made[2], run = o.run; const list: (() => unknown)[] = [run]; lines.push([2, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C2())), JSON.stringify(o)].join(" ")); }
{ const o = made[3], run = o.run; const list: (() => unknown)[] = [run]; lines.push([3, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C3())), JSON.stringify(o)].join(" ")); }
{ const o = made[4], run = o.run; const list: (() => unknown)[] = [run]; lines.push([4, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C4())), JSON.stringify(o)].join(" ")); }
{ const o = made[5], run = o.run; const list: (() => unknown)[] = [run]; lines.push([5, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C5())), JSON.stringify(o)].join(" ")); }
{ const o = made[6], run = o.run; const list: (() => unknown)[] = [run]; lines.push([6, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C6())), JSON.stringify(o)].join(" ")); }
{ const o = made[7], run = o.run; const list: (() => unknown)[] = [run]; lines.push([7, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C7())), JSON.stringify(o)].join(" ")); }
{ const o = made[8], run = o.run; const list: (() => unknown)[] = [run]; lines.push([8, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C8())), JSON.stringify(o)].join(" ")); }
{ const o = made[9], run = o.run; const list: (() => unknown)[] = [run]; lines.push([9, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C9())), JSON.stringify(o)].join(" ")); }
{ const o = made[10], run = o.run; const list: (() => unknown)[] = [run]; lines.push([10, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C10())), JSON.stringify(o)].join(" ")); }
{ const o = made[11], run = o.run; const list: (() => unknown)[] = [run]; lines.push([11, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C11())), JSON.stringify(o)].join(" ")); }
{ const o = made[12], run = o.run; const list: (() => unknown)[] = [run]; lines.push([12, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C12())), JSON.stringify(o)].join(" ")); }
{ const o = made[13], run = o.run; const list: (() => unknown)[] = [run]; lines.push([13, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C13())), JSON.stringify(o)].join(" ")); }
{ const o = made[14], run = o.run; const list: (() => unknown)[] = [run]; lines.push([14, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C14())), JSON.stringify(o)].join(" ")); }
{ const o = made[15], run = o.run; const list: (() => unknown)[] = [run]; lines.push([15, attempt(run), attempt(() => run()), list.map((h) => attempt(h)).join(), attempt(() => run.call(null as never)), attempt(() => run.call(new C15())), JSON.stringify(o)].join(" ")); }
console.log(lines.join("\n"));
