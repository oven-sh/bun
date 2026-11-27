// A loop stores other names into every object of a small array: those of a large one need no room for them.
function make(n: number): any[] { const list: any[] = []; for (let i = 0; i < n; i++) list.push({ a: i }); return list; }
function fill(list: any[]): void { for (let i = 0; i < list.length; i++) { const o = list[i]; o.f0 = i; o.f1 = i; o.f2 = i; o.f3 = i; o.f4 = i; o.f5 = i; o.f6 = i; o.f7 = i; o.f8 = i; o.f9 = i; o.f10 = i; o.f11 = i; o.f12 = i; o.f13 = i; o.f14 = i; o.f15 = i; o.f16 = i; o.f17 = i; o.f18 = i; o.f19 = i; o.f20 = i; o.f21 = i; o.f22 = i; o.f23 = i; o.f24 = i; o.f25 = i; o.f26 = i; o.f27 = i; o.f28 = i; o.f29 = i; o.f30 = i; o.f31 = i; o.f32 = i; o.f33 = i; o.f34 = i; o.f35 = i; o.f36 = i; o.f37 = i; o.f38 = i; o.f39 = i; } }
const plain = make(100000), small = make(3);
fill(small);
Bun.gc(true);
console.log(process.memoryUsage().heapUsed < 12e6 ? "small" : "large", plain.length, Object.keys(plain[1]).length, plain[2].a);
