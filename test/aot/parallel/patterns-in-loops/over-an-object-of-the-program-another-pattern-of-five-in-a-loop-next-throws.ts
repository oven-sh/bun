const shelf: any = globalThis;
shelf.flag = 0;
const log: string[] = [];
function unseen(x?: any): any { shelf.last = x; return shelf.flag; }
function tell(f: () => any): void { try { log.push("= " + String(f())); } catch (e: any) { log.push("threw " + (e && e.constructor ? e.constructor.name + ": " + e.message : String(e))); } }
class Steps {
  left: number;
  constructor(from: number) { this.left = from; }
  next(): any { log.push("next " + this.left); if (this.left === 2) throw new EvalError('in next'); if (this.left > 0) return { done: false, value: this.left-- }; return { done: true, value: undefined }; }
  return(v?: any): any { log.push("return " + String(v)); return { done: true, value: v }; }
}
class Holder {
  from: number;
  constructor(from: number) { this.from = from; }
  [Symbol.iterator](): any { log.push("open");  return new Steps(this.from); }
}
function make(from: number): any { return new Holder(from); }
function consume(it: any): any {
  let told = '';
  for (let k = 0; k < 2; k++) { const [a, b, c, d, e] = k ? make(2) : it; told += [a, b, c, d, e].join() + ';'; }
  return told;
}
function typed(from: number): any {
  const it = make(from);
  
  let told = '';
  for (let k = 0; k < 2; k++) { const [a, b, c, d, e] = k ? make(2) : it; told += [a, b, c, d, e].join() + ';'; }
  return told;
}
for (const from of [0, 1, 4]) {
  tell(() => typed(from));
  tell(() => consume(make(from)));
}
console.log(log.join('\n'));
