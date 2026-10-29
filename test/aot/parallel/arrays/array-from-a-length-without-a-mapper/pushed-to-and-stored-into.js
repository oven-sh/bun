function run(x) { const r = Array.from({ length: 2 }, x); r.push(7); r[0] = "s"; return r.map(v => typeof v).join(); } console.log(run());
