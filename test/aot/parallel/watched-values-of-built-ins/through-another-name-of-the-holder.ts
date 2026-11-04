// through another name of the holder
const k: string = JSON.parse('"env"');
const p: any = process;
const seen: unknown[] = [];
const first = process.env;
function look() { seen.push(process.env === first, typeof process.env, (process.env as any)?.WATCHED); }
for (let i = 0; i < 3; i++) look();
const other: any = [process, {}][seen.length > 100 ? 1 : 0];
other.env = { WATCHED: "another name" };
for (let i = 0; i < 3; i++) look();
console.log(seen.join());
