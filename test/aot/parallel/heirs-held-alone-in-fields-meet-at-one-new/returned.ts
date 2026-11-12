import type { int32 } from "bun";
const out: string[] = [];
class Base { constructor(readonly n: number) {}  }
class K extends Base { count: int32 = 0; bump(): int32 { return (this.n * 2) | 0; } }
class L extends Base {  }
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
out.push(String(new K(3).bump()));
console.log(out.join("|"));
export {};
