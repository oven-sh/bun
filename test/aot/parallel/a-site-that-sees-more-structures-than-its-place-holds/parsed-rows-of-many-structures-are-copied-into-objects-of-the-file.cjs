const texts = []; for (let i = 0; i < 32; i++) { const one = { id: i }; if (i & 2) one.a = i % 5; if (i & 4) one.b = i % 3 + 1; if (i & 8) one.c = i % 4; if (i & 16) one.d = i % 7; texts.push(JSON.stringify(one)); }
const rows = JSON.parse("[" + texts.join(",") + "]");
function make(r) { return { id: r.id, a: r.a ? r.a : undefined, b: r.b ? r.b : undefined, c: r.c ? r.c : undefined, d: r.d ? r.d : undefined }; }
const change = (0, eval)(`(function (rows) { rows[1].a = 9; delete rows[6].b; Object.defineProperty(rows[9], "c", { get() { return this.id + 100; } }); rows[17].d = "text"; })`);
const turns = Number(process.argv[2] ?? 6000); let sum = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === turns >> 1) change(rows);
    for (let i = 0; i < 32; i++) { const o = make(rows[i]); sum = (sum * 3 + o.id + (o.a || 0) + (o.b || 0) + (typeof o.c === "number" ? o.c : 0) + (typeof o.d === "string" ? o.d.length : o.d || 0)) % 1000003; }
}
console.log("SAID", sum);
