// A few of many objects call a method that stores other names: the many need no room for them. Where the constructor calls it, every object has room.
const N = 50000, few = Number(process.env.FEW ?? 3);
function heap(): number { Bun.gc(true); return process.memoryUsage().heapUsed; }
const kept: any[][] = [], said: string[] = [];
function P(this: any, a: number) { this.a = a; }
P.prototype.mark = function (i: number) { this.f0 = i; this.f1 = i; this.f2 = i; this.f3 = i; this.f4 = i; this.f5 = i; this.f6 = i; this.f7 = i; this.f8 = i; this.f9 = i; this.f10 = i; this.f11 = i; this.f12 = i; this.f13 = i; this.f14 = i; this.f15 = i; this.f16 = i; this.f17 = i; this.f18 = i; this.f19 = i; this.f20 = i; this.f21 = i; this.f22 = i; this.f23 = i; this.f24 = i; this.f25 = i; this.f26 = i; this.f27 = i; this.f28 = i; this.f29 = i; this.f30 = i; this.f31 = i; this.f32 = i; this.f33 = i; this.f34 = i; this.f35 = i; this.f36 = i; this.f37 = i; this.f38 = i; this.f39 = i; };
function Q(this: any, a: number) { this.a = a; this.fill(a); }
Q.prototype.fill = function (i: number) { this.f0 = i; this.f1 = i; this.f2 = i; this.f3 = i; this.f4 = i; this.f5 = i; this.f6 = i; this.f7 = i; this.f8 = i; this.f9 = i; this.f10 = i; this.f11 = i; this.f12 = i; this.f13 = i; this.f14 = i; this.f15 = i; this.f16 = i; this.f17 = i; this.f18 = i; this.f19 = i; this.f20 = i; this.f21 = i; this.f22 = i; this.f23 = i; this.f24 = i; this.f25 = i; this.f26 = i; this.f27 = i; this.f28 = i; this.f29 = i; this.f30 = i; this.f31 = i; this.f32 = i; this.f33 = i; this.f34 = i; this.f35 = i; this.f36 = i; this.f37 = i; this.f38 = i; this.f39 = i; };
function check(name: string, make: (list: any[]) => void, fill: (list: any[]) => void, isLarge = false) { const before = heap(), list: any[] = []; kept.push(list); make(list); fill(list); if (!isLarge) said.push(name + (heap() - before < 5e6 ? " small" : " large")); }
check("few", l => { for (let i = 0; i < N; i++) l.push(new (P as any)(i)); }, l => { for (let i = 0; i < few; i++) l[i * 3].mark(i); });
check("all", l => { for (let i = 0; i < N; i++) l.push(new (Q as any)(i)); }, () => {}, true);
const sum = (list: any[]) => { let s = 0; for (const o of list) if (o.f39 !== undefined) s += o.f39 + o.f0; return s; };
console.log(said.join(), kept.map(sum).join(), kept.map(l => l.length).join(), kept.map(l => Object.keys(l[3]).length).join(), Object.keys(kept[0][1]).length);
