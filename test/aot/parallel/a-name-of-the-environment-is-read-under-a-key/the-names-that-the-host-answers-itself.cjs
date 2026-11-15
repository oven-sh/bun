function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const readers = ["TZ", "NODE_TLS_REJECT_UNAUTHORIZED", "BUN_CONFIG_VERBOSE_FETCH"].map(name => kept(name, parser));
for (let t = 0; t < 12; t++) { if (t === 3) { process.env.TZ = "Asia/Tokyo"; process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; process.env.BUN_CONFIG_VERBOSE_FETCH = "curl"; } if (t === 6) said.push(new Date(0).getHours()); if (t === 8) { process.env.TZ = "UTC"; delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; delete process.env.BUN_CONFIG_VERBOSE_FETCH; } for (const reader of readers) said.push(reader()); }
said.push(new Date(0).getHours());
console.log(said.join(" "), parses);
