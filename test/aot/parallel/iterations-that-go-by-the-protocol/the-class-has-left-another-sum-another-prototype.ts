const shelf: any = globalThis;
shelf.flag = 0;
const log: string[] = [];
function unseen(x?: any): any { shelf.last = x; return shelf.flag; }
function tell(f: () => any): void { try { log.push("= " + String(f())); } catch (e: any) { log.push("threw " + (e && e.constructor ? e.constructor.name + ": " + e.message : String(e))); } }
class Steps {
  left: number;
  constructor(from: number) { this.left = from; }
  next(): any { log.push("next " + this.left);  if (this.left > 0) return { done: false, value: this.left-- }; return { done: true, value: undefined }; }
  
}
class Holder {
  from: number;
  constructor(from: number) { this.from = from; }
  [Symbol.iterator](): any { log.push("open");  return new Steps(this.from); }
}
function make(from: number): any { return new Holder(from); }
shelf.box = make(1);
function consume(it: any): any {
  let sum = 0;
  for (const v of it) sum += v;
  return sum;
}
function typed(from: number): any {
  const it = make(from);
  if (!unseen()) Object.setPrototypeOf(it, { next() { log.push('foreign next'); return { done: true, value: undefined }; }, [Symbol.iterator]() { log.push('foreign open'); return this; } });
  let sum = 0;
  for (const v of it) sum += v;
  return sum;
}
for (const from of [0, 1, 4]) {
  tell(() => typed(from));
  tell(() => consume(make(from)));
}
console.log(log.join('\n'));
