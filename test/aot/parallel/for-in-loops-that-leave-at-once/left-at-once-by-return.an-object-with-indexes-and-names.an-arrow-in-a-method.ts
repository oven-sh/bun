const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (): any => JSON.parse('{"b":1,"2":2,"a":3,"0":4,"c":5}');
class Holder { go = (depth: number): unknown => { for (const k in make()) {  return 'has ' + k; } say('empty'); return 'end'; }; }
const holder = new Holder();
for (let round = 0; round < 30; round++) { log.length = 0; try { say(holder.go(0)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
