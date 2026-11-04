const later = [];
for (let i = 0; i < 3; i++) { const k = i * 2; later.push(() => i + ":" + k); }
{ let hidden = 5; later.push(() => hidden++); later.push(() => hidden); }
let n = 0;
while (n < 2) { let turn = n++; later.push(() => turn); }
try { throw new Error("caught"); } catch (e) { later.push(() => e.message); }
console.log(later.map(f => f()).join(" "));
