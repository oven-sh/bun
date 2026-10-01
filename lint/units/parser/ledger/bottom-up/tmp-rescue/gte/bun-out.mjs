import fs from 'fs';
const inputs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const t = new Bun.Transpiler({ loader: 'ts' });
for (const src of inputs) { try { console.log(JSON.stringify(src) + "  =>  " + JSON.stringify(t.transformSync(src))); } catch (e) { console.log(JSON.stringify(src) + "  =>  ERR"); } }
