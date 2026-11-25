const n = 160000;
const list: any[] = []; for (let i = 0; i < n; i++) list.push({ id: i });
let taken = 0;
for (let i = 0; i < 3000; i++) { taken = (taken + list.splice(1 + (i & 3), 1)[0].id) | 0; if ((i & 7) === 0) list.splice(2, 0, { id: -i }, { id: -i - 1 }); if ((i & 511) === 0) Bun.gc(true); }
let sum = 0; for (let i = 0; i < list.length; i++) sum = (sum * 31 + list[i].id) | 0;
console.log(list.length, taken, sum, list[0].id, list[1].id, list[2].id);
