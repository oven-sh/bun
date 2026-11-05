const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const hidden = (x: unknown): any => [x][JSON.parse("0")];
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (n: number): any => hidden(({ [Symbol.iterator]() { let i = 0; return { next() { return i < n ? { done: false, value: i++ * 10 } : { done: true, value: undefined }; } }; } }));
async function run(depth: number): Promise<unknown> { await null; const one = make(4); for (const a of one) { say('a', a); for (const b of one) { say('b', b); } } await null; return 'end'; }
for (let round = 0; round < 30; round++) { log.length = 0; try { say(await run(0)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
