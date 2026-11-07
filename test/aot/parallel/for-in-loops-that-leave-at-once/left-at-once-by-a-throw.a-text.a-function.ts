const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(String).join(" ")); };
const litter = () => { let kept: unknown[] = []; for (let i = 0; i < 400; i++) kept = [kept.length, { i }, "t" + i]; return kept.length; };
const make = (): any => JSON.parse('"abcde"');
function run(depth: number): unknown { try { for (const k in make()) {  throw new Error('has ' + k); } say('empty'); } catch (error) { say('caught', (error as Error).message); } return 'end'; }
for (let round = 0; round < 30; round++) { log.length = 0; try { say(run(0)); } catch (error) { say('came out', (error as Error).message); } }
console.log(log.join('\n'));
