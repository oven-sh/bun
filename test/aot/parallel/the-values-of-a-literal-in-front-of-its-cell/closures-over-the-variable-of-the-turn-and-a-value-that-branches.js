function run(n) { const out = []; for (let i = 0; i < n; i++) out.push({ get: () => i, bump: () => (i += 10), step: 1, tag: i & 1 ? "o" : "e" }); return out; }
const all = run(JSON.parse("4"));
console.log("SAID", all.map((o) => [o.get(), o.bump(), o.get(), o.get === o.get, o.step, o.tag].join(" ")).join(" | "), all[0].get === all[1].get);
