// a constructor fills a field, starts a coroutine that reads the field on both sides of an await, and stores into the field once more
let pending = null;
async function subject(box) { const before = box.size; await null; return before * 100 + box.size; }
class Box { constructor(size) { this.size = size; } }
class Late { constructor(size) { this.size = size; pending = subject(this); this.size = size + 1; } }
async function deed() { new Late(7); return await pending; }
console.log(String(await subject(new Box(3))));
console.log(String(await deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += await deed();
console.log(String(total));
console.log(String(await subject(new Box(3))));
