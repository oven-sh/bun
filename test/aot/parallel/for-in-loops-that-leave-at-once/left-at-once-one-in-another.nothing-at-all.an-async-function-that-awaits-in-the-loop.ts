const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (): any => JSON.parse('null');
async function run(depth: number): Promise<unknown> { for (const a in make()) { for (const b in make()) { await null; say('ab', a, b); await null; break; } litter(); Bun.gc(true); say('a', a); break; } return 'end'; }
for (let round = 0; round < 30; round++) { log.length = 0; try { say(await run(0)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
