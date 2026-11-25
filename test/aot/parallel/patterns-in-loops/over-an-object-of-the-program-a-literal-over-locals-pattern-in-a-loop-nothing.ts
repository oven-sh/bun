const shelf: any = globalThis;
shelf.flag = 0;
const log: string[] = [];
function unseen(x?: any): any { shelf.last = x; return shelf.flag; }
function tell(f: () => any): void { try { log.push("= " + String(f())); } catch (e: any) { log.push("threw " + (e && e.constructor ? e.constructor.name + ": " + e.message : String(e))); } }
class Steps { static marker = 1; }
class Holder {
  from: number;
  constructor(from: number) { this.from = from; }
  [Symbol.iterator](): any {
    log.push("open"); 
    let left = this.from;
    return { next(): any { log.push("next " + left); if (left > 0) return { done: false, value: left-- }; return { done: true, value: undefined }; } };
  }
}
function make(from: number): any { return new Holder(from); }
function consume(it: any): any {
  let told = '';
  for (let k = 0; k < 3; k++) { const [a, b] = it; told += a + ',' + b + ';'; }
  return told;
}
function typed(from: number): any {
  const it = make(from);
  
  let told = '';
  for (let k = 0; k < 3; k++) { const [a, b] = it; told += a + ',' + b + ';'; }
  return told;
}
for (const from of [0, 1, 4]) {
  tell(() => typed(from));
  tell(() => consume(make(from)));
}
console.log(log.join('\n'));
