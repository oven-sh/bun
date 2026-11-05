const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(p => typeof p === "object" && p ? JSON.stringify(p) : String(p)).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 300; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const kept: any[] = [];
const show = (a: any) => Array.prototype.map.call(a, (x: unknown) => (typeof x === "object" && x ? JSON.stringify(x) : Object.is(x, -0) ? "-0" : String(x))).join(",") + "#" + a.length;
function callee(this: any, a?: any) { return { n: arguments.length, held: arguments }; }
const read = (r: any) => r.n + ':' + show(r.held);
class Holder { go = (x: number): unknown => { const r = callee(x, 1, 2, 3, 4, 5, 6); return read(r); }; }
const holder = new Holder();
for (let round = 0; round < 40; round++) { log.length = 0; try { say(holder.go(round)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
