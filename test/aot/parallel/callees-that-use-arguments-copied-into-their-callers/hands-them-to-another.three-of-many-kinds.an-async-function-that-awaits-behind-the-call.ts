const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(p => typeof p === "object" && p ? JSON.stringify(p) : String(p)).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 300; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const kept: any[] = [];
const show = (a: any) => Array.prototype.map.call(a, (x: unknown) => (typeof x === "object" && x ? JSON.stringify(x) : Object.is(x, -0) ? "-0" : String(x))).join(",") + "#" + a.length;
const other = (x: any) => { kept.push(x); if (kept.length > 4) kept.shift(); return x; };
function callee(this: any, a?: any) { return other(arguments); }
const read = (r: any) => show(r) + (kept[kept.length - 1] === r);
async function run(x: number): Promise<unknown> { const r = callee(x, 'text', { k: x }); await null; Bun.gc(true); return read(r); }
for (let round = 0; round < 40; round++) { log.length = 0; try { say(await run(round)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
