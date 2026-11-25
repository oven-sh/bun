const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(part => typeof part === "object" && part !== null ? JSON.stringify(part) : String(part)).join(" ")); };
const marks = (name: string, turns: number) => { let p = Promise.resolve(); for (let i = 0; i < turns; i++) p = p.then(() => say("mark", name, i)); };
const later = <T,>(value: T, turns: number): Promise<T> => { let p: Promise<unknown> = Promise.resolve(); for (let i = 0; i < turns; i++) p = p.then(() => {}); return p.then(() => value); };
const failing = (text: string, turns: number): Promise<never> => later(0, turns).then(() => { throw new Error(text); });
const told = (error: unknown) => error instanceof Error ? "Error " + error.message : "thrown " + String(error);
async function* inner(limit: number): AsyncGenerator<any, any, any> { for (let i = 0; i < limit; i++) { const got = yield 'inner ' + i; say('inner got', got); } return 'inner end'; }
async function* make(limit: number): AsyncGenerator<any, any, any> { say('body begins'); for (let i = 0; i < limit; i++) { const got = yield later(i * 10, i % 3) as any; say('body got', got); } return 'end'; }
async function consume(walk: AsyncGenerator<any, any, any>): Promise<void> { for (let i = 0; i < 8; i++) { const promise = walk.next(i); say('asked'); const step = await promise; say('step', step.done, step.value); if (step.done) break; } }
for (let round = 0; round < 40; round++) {
  log.length = 0; marks('m', 12);
  try { await consume(make(3)); say('whole'); } catch (error) { say('came out', told(error)); }
  await later(0, 14);
}
console.log(log.join('\n'));
