const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(p => typeof p === "object" && p ? JSON.stringify(p) : String(p)).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 300; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const kept: any[] = [];
const show = (a: any) => Array.prototype.map.call(a, (x: unknown) => (typeof x === "object" && x ? JSON.stringify(x) : Object.is(x, -0) ? "-0" : String(x))).join(",") + "#" + a.length;
function callee(this: any, a?: any) { return { held: arguments }; }
const read = (r: any) => show(r.held);
function run(x: number): unknown { let last = ''; for (let i = 0; i < 3; i++) { const r = callee(1, -0, undefined, null, x); last += read(r) + ';'; x++; } return last; }
for (let round = 0; round < 40; round++) { log.length = 0; try { say(run(round)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
