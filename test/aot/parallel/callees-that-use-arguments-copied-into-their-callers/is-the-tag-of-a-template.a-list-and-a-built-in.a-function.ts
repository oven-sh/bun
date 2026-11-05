const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(p => typeof p === "object" && p ? JSON.stringify(p) : String(p)).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 300; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const kept: any[] = [];
const show = (a: any) => Array.prototype.map.call(a, (x: unknown) => (typeof x === "object" && x ? JSON.stringify(x) : Object.is(x, -0) ? "-0" : String(x))).join(",") + "#" + a.length;
class Logger { constructor(readonly held: IArguments) {} }
function callee(this: any, strings?: any, ...values: any[]) { return new Logger(arguments); }
const read = (r: any) => show(Array.prototype.slice.call(r.held, typeof r.held[0] === 'object' && r.held[0] && 'raw' in r.held[0] ? 1 : 0)) + '/' + r.held.length;
function run(x: number): unknown { const r = callee`p${[x, x]}p${Math.max}q`; litter(); return read(r); }
for (let round = 0; round < 40; round++) { log.length = 0; try { say(run(round)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
