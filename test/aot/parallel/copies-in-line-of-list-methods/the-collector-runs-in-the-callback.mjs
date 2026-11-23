const said = [];
const show = (list) => Array.from(list, (v) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join("|");
const kept = []; let total = 0;
for (let i = 0; i < 3000; i++) { const whole = [i, i + 1, i + 2, i + 3]; const made = whole.map((v, k) => { if ((i & 255) === 0 && k === 1) Bun.gc(true); return k === 0 ? v : { v, text: "t" + v }; }); const some = whole.filter((v, k) => { if ((i & 511) === 0 && k === 2) Bun.gc(true); return k !== 1; }); if ((i & 255) === 0) kept.push(made, some); total += made[3].text.length + some[2]; }
Bun.gc(true); for (const list of kept) total += list.length + (typeof list[1] === "object" ? list[1].v : list[1]);
said.push(total);
console.log(said.join("\n"));
