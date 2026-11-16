const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
let total = 0; const kept: unknown[] = [];
for (let turn = 0; turn < 400; turn++) { const list = [{ n: turn }, { n: turn + 1 }, { n: turn + 2 }]; for (const [i, row] of list.entries()) { if ((turn & 63) === 0 && i === 1) Bun.gc(true); total += row.n * i; if ((turn & 127) === 0) kept.push([i, row]); } for (const pair of list.entries()) { if ((turn & 127) === 1) { Bun.gc(true); kept.push(pair); } } }
Bun.gc(true); said.push(total, kept.length, kept);
console.log(said.map(show).join(" "));
