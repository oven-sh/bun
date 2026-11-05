const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const hidden = (x: unknown): any => [x][JSON.parse("0")];
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (n: number): any => hidden(({ [Symbol.iterator]() { let i = 0; return { next() { if (i === 3) throw new RangeError('next at ' + i); return i < n ? { done: false, value: i++ * 10 } : { done: true, value: undefined }; }, return() { say('closed'); return {}; } }; } }));
async function run(depth: number): Promise<unknown> { await null; if (depth < 3) for (const v of make(2)) { say('d', depth, v); await run(depth + 1); } await null; return 'end'; }
for (let round = 0; round < 30; round++) { log.length = 0; try { say(await run(0)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
