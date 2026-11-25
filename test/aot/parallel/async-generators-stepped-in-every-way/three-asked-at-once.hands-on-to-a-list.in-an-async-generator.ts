const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(part => typeof part === "object" && part !== null ? JSON.stringify(part) : String(part)).join(" ")); };
const marks = (name: string, turns: number) => { let p = Promise.resolve(); for (let i = 0; i < turns; i++) p = p.then(() => say("mark", name, i)); };
const later = <T,>(value: T, turns: number): Promise<T> => { let p: Promise<unknown> = Promise.resolve(); for (let i = 0; i < turns; i++) p = p.then(() => {}); return p.then(() => value); };
const failing = (text: string, turns: number): Promise<never> => later(0, turns).then(() => { throw new Error(text); });
const told = (error: unknown) => error instanceof Error ? "Error " + error.message : "thrown " + String(error);
async function* inner(limit: number): AsyncGenerator<any, any, any> { for (let i = 0; i < limit; i++) { const got = yield 'inner ' + i; say('inner got', got); } return 'inner end'; }
async function* make(limit: number): AsyncGenerator<any, any, any> { say('body begins'); yield* [1, later(2, 1) as any, 3]; return 'end'; }
async function* consume(walk: AsyncGenerator<any, any, any>): AsyncGenerator<string, void, void> { yield 'begun'; const three = [walk.next('a'), walk.next('b'), walk.next('c')]; say('asked three'); for (const promise of three) { try { const step = await promise; say('step', step.done, step.value); } catch (error) { say('a step failed', told(error)); } } const last = await walk.next('d'); say('last', last.done, last.value); yield 'ended'; }
for (let round = 0; round < 40; round++) {
  log.length = 0; marks('m', 12);
  try { for await (const word of consume(make(3))) say('outer', word); say('whole'); } catch (error) { say('came out', told(error)); }
  await later(0, 14);
}
console.log(log.join('\n'));
