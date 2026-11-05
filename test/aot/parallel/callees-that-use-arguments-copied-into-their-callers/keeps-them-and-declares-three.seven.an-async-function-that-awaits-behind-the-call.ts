const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(p => typeof p === "object" && p ? JSON.stringify(p) : String(p)).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 300; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const kept: any[] = [];
const show = (a: any) => Array.prototype.map.call(a, (x: unknown) => (typeof x === "object" && x ? JSON.stringify(x) : Object.is(x, -0) ? "-0" : String(x))).join(",") + "#" + a.length;
function callee(this: any, a?: any, b?: any, c?: any) { return { held: arguments, sum: String(a) + b + c }; }
const read = (r: any) => show(r.held) + r.sum;
async function run(x: number): Promise<unknown> { const r = callee(x, 1, 2, 3, 4, 5, 6); await null; Bun.gc(true); return read(r); }
for (let round = 0; round < 40; round++) { log.length = 0; try { say(await run(round)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
