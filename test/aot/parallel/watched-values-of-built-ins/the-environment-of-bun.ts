// the environment of bun
const k: string = JSON.parse('"env"');
const b: any = Bun;
const seen: unknown[] = [];
const first = Bun.env;
b[k + "NotAMember"] = 1;
for (let i = 0; i < 3; i++) seen.push(Bun.env === first, Bun.env === process.env);
try { b[k] = { WATCHED: "stored" }; } catch (e: any) { seen.push(e.constructor.name); }
for (let i = 0; i < 3; i++) seen.push(Bun.env === first, (Bun.env as any).WATCHED);
console.log(seen.join());
