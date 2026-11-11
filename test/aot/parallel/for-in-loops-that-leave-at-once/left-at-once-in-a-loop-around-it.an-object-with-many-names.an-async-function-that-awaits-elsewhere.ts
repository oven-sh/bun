const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (): any => Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['k' + i, i]));
async function run(depth: number): Promise<unknown> { await null; for (let round = 0; round < 3; round++) { for (const k in make()) {  say('r', round, k); break; } } await null; return 'end'; }
for (let round = 0; round < 30; round++) { log.length = 0; try { say(await run(0)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
