const fs = require("node:fs");
const sources = JSON.parse(fs.readFileSync("/tmp/a3-td/t2/sources.json", "utf8"));
const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const options = [{}, { tsconfig }, { minify: { whitespace: true, syntax: true, identifiers: true } }];
const t = options.map(o => ({ ts: new Bun.Transpiler({ loader: "ts", ...o }), tsx: new Bun.Transpiler({ loader: "tsx", ...o }) }));
const out = [];
sources.forEach(([loader, text], i) => { for (const c of [0, 1, 2]) { let r; try { r = { code: t[c][loader].transformSync(text) }; } catch (e) { r = { errors: (e?.errors ?? [e]).map(x => String(x?.message ?? x)) }; } out.push({ i, c, ...r }); } });
fs.writeFileSync(process.argv[2], JSON.stringify(out));
