// stored twice
const k: string = JSON.parse('"env"');
const p: any = process;
const seen: unknown[] = [];
const first = process.env;
function look() { seen.push(process.env === first, typeof process.env, (process.env as any)?.WATCHED); }
for (let i = 0; i < 3; i++) look();
p[k] = { WATCHED: "once" };
look();
p[k] = { WATCHED: "twice" };
for (let i = 0; i < 3; i++) look();
console.log(seen.join());
