// V1, by its reader (REVIEW.txt:3 b): a field initializer hands this out, and the constructor stores into the field behind it
async function watch(o) { const b = o.size; await null; return b * 100 + o.size; }
class Box { size = 1; tag = watch(this); constructor(s) { this.size = s; } }
for (let i = 0; i < 3; i++) { const box = new Box(5); console.log(String(await box.tag)); }
