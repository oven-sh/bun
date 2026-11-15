class Kept { id: number; constructor(id: number) { this.id = id; } }
const pool: Kept[] = [];
class Pooled { id: number; tag: string;
  constructor(id: number) { this.id = id; this.tag = "t" + id; if (id & 1) return pool[0] as unknown as Pooled; } }
function PlainF(this: { id: number }, id: number) { this.id = id; if (id & 1) return { id: -id, other: true }; }
const Plain = PlainF as unknown as { new (id: number): { id: number; other?: boolean } };
pool.push(new Kept(77));
let text = "";
for (let i = 0; i < 300; i++) { const a = new Pooled(i); const b = new Plain(i); text = a.id + ":" + String((a as any).tag) + " " + b.id + ":" + String(b.other); }
console.log(text);
const c = new Pooled(2); const d = new Plain(2);
console.log(c.id + ":" + c.tag, d.id + ":" + String(d.other));
export {};
