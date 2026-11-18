const shelf: any = globalThis;
const bounds = [3];
class Rack {
  from: number;
  constructor(from: number) { this.from = from; }
  [Symbol.iterator](): any {
    let at = this.from;
    return { next: (): any => { const [limit] = bounds; return at < limit ? { done: false, value: at++ } : { done: true, value: undefined }; } };
  }
}
shelf.box = new Rack(1);
const hooks = [(x: number) => x + 1, (x: number) => x + 2];
function few(it: number[] | Rack, hook: (x: number) => number): string {
  let t = 0, sum = 0, turns = 0;
  [t]=[t+1];[t]=[t+1];
  for (const v of it) { sum += hook(v); if (++turns > 50) break; }
  return sum + " " + turns + " " + t;
}
function many(it: number[] | Rack, hook: (x: number) => number): string {
  let t = 0, sum = 0, turns = 0;
  [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1];
  [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1];
  [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1];
  [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1];
  [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1]; [t]=[t+1];[t]=[t+1];
  [t]=[t+1];[t]=[t+1];[t]=[t+1];
  for (const v of it) { sum += hook(v); if (++turns > 50) break; }
  return sum + " " + turns + " " + t;
}
const pick = hooks[JSON.parse("0")];
console.log(few(new Rack(0), pick), "|", few(JSON.parse("[1,2,3]"), pick));
console.log(many(new Rack(0), pick), "|", many(JSON.parse("[1,2,3]"), pick));
