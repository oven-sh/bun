import type { int32 } from "bun";
const out: string[] = [];
class Base { constructor(readonly n: number) {}  }
class K extends Base { count: int32 = 0; *walk(): Generator<number> { let i: int32 = 0; while (i < 3) { yield i; i = (i + 1) | 0; } } }
class L extends Base {  }
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
out.push([...new K(1).walk()].join());
console.log(out.join("|"));
export {};
