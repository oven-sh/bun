// by code out of sight
const k: string = JSON.parse('"env"');
const p: any = process;
const seen: unknown[] = [];
const first = process.env;
function look() { seen.push(process.env === first, typeof process.env, (process.env as any)?.WATCHED); }
for (let i = 0; i < 3; i++) look();
(globalThis as any).deeds = [(o: any, name: string) => { o[name] = { WATCHED: "out of sight" }; }];
(globalThis as any).deeds[0](p, k);
for (let i = 0; i < 3; i++) look();
console.log(seen.join());
