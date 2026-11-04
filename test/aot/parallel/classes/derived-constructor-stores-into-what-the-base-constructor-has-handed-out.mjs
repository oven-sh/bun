// V1, by its reader (REVIEW.txt:3 a): one construction has several making bodies: what the base constructor has handed out the derived constructor still stores into, so a field written at construction alone does not keep its value once filled
let pending;
class Base { constructor(s) { this.size = s; pending = watch(this); } }
class Late extends Base { constructor(s) { super(s); this.size = s + 1; } }
async function watch(o) { const b = o.size; await null; return b * 100 + o.size; }
for (let i = 0; i < 3; i++) { new Late(7); console.log(String(await pending)); }
