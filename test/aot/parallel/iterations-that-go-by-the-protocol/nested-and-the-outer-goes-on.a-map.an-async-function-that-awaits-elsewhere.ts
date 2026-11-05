const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const hidden = (x: unknown): any => [x][JSON.parse("0")];
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (n: number): any => hidden(new Map(Array.from({ length: n }, (_, i) => [i, i * 10] as [number, number])).values());
async function run(depth: number): Promise<unknown> { await null; outer: for (const a of make(3)) { for (const b of make(4)) { say('ab', a, b); if (b === 10 || b === 'b') continue outer; } say('never'); } await null; return 'end'; }
for (let round = 0; round < 30; round++) { log.length = 0; try { say(await run(0)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
