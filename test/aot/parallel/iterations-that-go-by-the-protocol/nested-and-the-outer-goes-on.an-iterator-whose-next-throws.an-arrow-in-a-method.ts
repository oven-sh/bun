const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const hidden = (x: unknown): any => [x][JSON.parse("0")];
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (n: number): any => hidden(({ [Symbol.iterator]() { let i = 0; return { next() { if (i === 3) throw new RangeError('next at ' + i); return i < n ? { done: false, value: i++ * 10 } : { done: true, value: undefined }; }, return() { say('closed'); return {}; } }; } }));
class Holder { go = (depth: number): unknown => { outer: for (const a of make(3)) { for (const b of make(4)) { say('ab', a, b); if (b === 10 || b === 'b') continue outer; } say('never'); } return 'end'; }; }
const holder = new Holder();
for (let round = 0; round < 30; round++) { log.length = 0; try { say(holder.go(0)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
