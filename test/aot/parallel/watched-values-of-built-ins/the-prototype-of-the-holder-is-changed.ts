// the prototype of the holder is changed
const k: string = JSON.parse('"env"');
const p: any = process;
const seen: unknown[] = [];
const first = process.env;
function look() { seen.push(process.env === first, typeof process.env, (process.env as any)?.WATCHED); }
for (let i = 0; i < 3; i++) look();
const above = Object.getPrototypeOf(p);
Object.setPrototypeOf(p, Object.create(above));
look();
delete p[k];
Object.getPrototypeOf(p)[k] = { WATCHED: "from above" };
for (let i = 0; i < 3; i++) look();
console.log(seen.join());
