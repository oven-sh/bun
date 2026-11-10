const shelf: any = globalThis;
shelf.flag = 0;
const log: string[] = [];
function unseen(x?: any): any { shelf.last = x; return shelf.flag; }
function tell(f: () => any): void { try { log.push("= " + String(f())); } catch (e: any) { log.push("threw " + (e && e.constructor ? e.constructor.name + ": " + e.message : String(e))); } }
class Steps {
  left: number;
  answer: { done: boolean; value: any };
  constructor(from: number) { this.left = from; this.answer = { done: false, value: 0 }; }
  next(): any { log.push("next " + this.left);  if (this.left > 0) { this.answer.value = this.left--; return this.answer; } this.answer.done = true; this.answer.value = undefined; return this.answer; }
  [Symbol.iterator](): any { log.push("open");  return this; }
  
}
function make(from: number): any { return new Steps(from); }
function consume(it: any): any {
  let sum = 0;
  for (const v of it) sum += v;
  return sum;
}
function typed(from: number): any {
  const it = make(from);
  
  let sum = 0;
  for (const v of it) sum += v;
  return sum;
}
for (const from of [0, 1, 4]) {
  tell(() => typed(from));
  tell(() => consume(make(from)));
}
console.log(log.join('\n'));
