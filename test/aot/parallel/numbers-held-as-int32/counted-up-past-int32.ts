// counted up past int32
class Counter { id: number; constructor(id: number) { this.id = id; } }
const table: string[] = []; function at(c: Counter) { return table[c.id]; }
const c = new Counter(2147483645); (globalThis as any).kept = c;
const said: string[] = [];
for (let i = 0; i < 5; i++) { c.id++; said.push(String(c.id)); }
for (let i = 0; i < 5; i++) { c.id -= 1; said.push(String(c.id)); }
const d = new Counter(-2147483640); (globalThis as any).other = d;
for (let i = 0; i < 12; i++) { d.id--; said.push(String(d.id)); }
console.log(said.join(), at(c), at(d));
