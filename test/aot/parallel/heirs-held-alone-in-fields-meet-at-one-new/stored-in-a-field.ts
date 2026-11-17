import type { int32 } from "bun";
const out: string[] = [];
class Base { constructor(readonly n: number) {}  }
class K extends Base { count: int32 = 0; bump(): void { this.count = (this.count + 1) | 0; } }
class L extends Base {  }
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
const k = new K(1); k.bump(); out.push(String(k.count));
console.log(out.join("|"));
export {};
