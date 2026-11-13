const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
let total = 0; const kept: unknown[] = [];
for (let turn = 0; turn < 600; turn++) { const rows = [{ n: turn }, { n: turn + 1 }, { n: turn + 2 }]; const made = rows.map((r, i) => { if ((turn & 127) === 0 && i === 1) Bun.gc(true); return { twice: r.n * 2, text: "t" + r.n }; }); const some = rows.filter((r, i) => { if ((turn & 255) === 0 && i === 2) Bun.gc(true); return i !== 1; }); rows.forEach(r => { total += r.n; }); total += made[2].text.length + some[1].n; if ((turn & 127) === 0) kept.push(made, some); }
Bun.gc(true); said.push(total, kept);
console.log(said.map(show).join(" "));
