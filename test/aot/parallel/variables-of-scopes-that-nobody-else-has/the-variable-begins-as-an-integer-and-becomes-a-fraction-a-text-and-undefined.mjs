function each(list, f) { for (let i = 0; i < list.length; i++) f(list[i], i); }
const rows = []; for (let i = 0; i < 12; i++) rows.push({ id: i, name: "n" + i });
function total(list, mode) { let sum = 0; each(list, (row, i) => { if (mode === 1) sum += row.id / 4; else if (mode === 2 && i === 5) sum = sum + "!"; else if (mode === 3 && i === 7) sum = undefined; else if (mode === 4) sum += 2 ** 30; else if (mode === 5 && i === 3) sum = -0; else if (mode === 6 && i === 2) sum = { valueOf() { return 7; } }; else sum += row.id; }); return sum; }
const out = []; for (let t = 0; t < 40; t++) for (let mode = 0; mode < 7; mode++) out[mode] = total(rows, mode);
console.log(out.map(v => typeof v + ":" + String(v)).join("|"), Object.is(total(rows.slice(0, 4), 5), -0));
