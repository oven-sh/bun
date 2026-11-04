// other members come and go
const k: string = JSON.parse('"env"');
const p: any = process;
const seen: unknown[] = [];
const first = process.env;
function look() { seen.push(process.env === first, typeof process.env, (process.env as any)?.WATCHED); }
for (let i = 0; i < 3; i++) look();
for (let i = 0; i < 40; i++) p["added" + i] = i;
look();
for (let i = 0; i < 40; i += 2) delete p["added" + i];
look();
process.title; process.versions; process.config; process.release;
for (let i = 0; i < 3; i++) look();
console.log(seen.join());
