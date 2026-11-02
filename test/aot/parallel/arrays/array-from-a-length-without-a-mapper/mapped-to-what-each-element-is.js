function run(x) { const r = Array.from({ length: 2 }, x); return r.map(v => [typeof v, v === undefined, v ?? "d", String(v), v == null].join("/")).join(" "); } console.log(run());
