const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (): any => JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5}');
function* run(depth: number): Generator<unknown, unknown, unknown> { let first = 'none'; for (const k in make()) { first = k; yield 1; break; } say('first', first); return 'end'; }
for (let round = 0; round < 30; round++) { log.length = 0; try { for (const y of run(0)) say('yielded', y); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
