// The typed twin of callbacks-kept-only-on-the-rare-path.js. Values of the wrong type arrive through `any`, so a type check can fail between the creation of a callback and the call that takes it, and the untyped path keeps the callback.
type Visit = (value: number) => number;
interface Target { on(listener: Visit): void; off(listener: Visit): boolean; emit(value: number): void }
interface Options { scale: number; keep: boolean }
const kept: Visit[] = [];

class Keeping extends Array<number> {
  forEach(callback: any): void { kept.push(callback); super.forEach(callback); }
  map(callback: any): any { kept.push(callback); return super.map(callback); }
  filter(callback: any): any { kept.push(callback); return super.filter(callback); }
}
const collection: any = {
  items: [7, 8],
  forEach(callback: any) { kept.push(callback); for (const item of this.items) callback(item); },
  map(callback: any) { kept.push(callback); return [callback(this.items[0]), callback(this.items[1])]; },
  filter(callback: any) { kept.push(callback); return callback(this.items[0]) ? [this.items[0]] : []; },
};

class Emitter implements Target {
  listeners: Visit[] = [];
  on(listener: Visit): void { this.listeners.push(listener); }
  off(listener: Visit): boolean {
    const index = this.listeners.indexOf(listener);
    if (index < 0) return false;
    this.listeners.splice(index, 1);
    return true;
  }
  emit(value: number): void { for (const listener of this.listeners.slice()) listener(value); }
}
class Immediate implements Target {
  on(listener: Visit): void { listener(1); }
  off(): boolean { return false; }
  emit(): void {}
}
const untypedTarget: any = { on(listener: any) { kept.push(listener); listener(5); }, off() { return "never"; }, emit() {} };

function each(list: number[], visit: Visit): void { for (let index = 0; index < list.length; index++) visit(list[index]); }
function hold(list: number[], visit: Visit): void { kept.push(visit); each(list, visit); }

function summed(list: number[]): number {
  let sum = 0;
  list.forEach(value => (sum += value));
  sum += 1000;
  return sum;
}
function scaled(list: number[], factor: number): string {
  return list.map(value => value * factor).join();
}
function above(list: number[], limit: number): string {
  let rejected = 0;
  const passed = list.filter(value => value > limit || (rejected++, false));
  return passed.join() + "/" + rejected;
}
function stopped(list: number[], limit: number): string {
  let seen = 0;
  try {
    list.forEach(value => {
      if (value > limit) throw new RangeError("over " + value);
      return (seen += value);
    });
  } catch (error: any) {
    return error.name + ": " + error.message + " after " + seen;
  }
  return "all " + seen;
}
function weighted(list: number[], weights: number[]): string {
  let sum = 0;
  const add: Visit = value => (sum += value);
  const weight = weights[0];
  list.forEach(add);
  return sum * weight + ":" + typeof weight;
}
function applied(list: number[], options: Options): string {
  let sum = 0;
  const add: Visit = value => (sum += value);
  const scale = options.scale;
  if (options.keep) hold(list, add);
  else each(list, add);
  return sum * scale + ":" + typeof scale;
}
function subscribed(target: Target): string {
  let heard = 0;
  const listener: Visit = value => (heard += value);
  target.on(listener);
  target.emit(10);
  const removed = target.off(listener);
  target.emit(100);
  return heard + ":" + removed;
}
function rounds(lists: number[][]): string {
  let out = "";
  for (let round = 0; round < lists.length; round++) {
    let count = round * 100;
    lists[round].forEach(value => (count += value));
    count++;
    out += count + ";";
  }
  return out;
}

function again(from: number): string {
  Bun.gc(true);
  const results: string[] = [];
  for (let index = from; index < kept.length; index++) {
    try {
      results.push(String(kept[index](1)));
    } catch (error: any) {
      results.push(error.name);
    }
  }
  return results.join() + " (" + new Set(kept.slice(from)).size + " of " + (kept.length - from) + ")";
}

const plain: number[] = [1, 2, 3];
const switching: number[] = [1, 5, 9];
const emitter = new Emitter();
const immediate = new Immediate();
const lines: string[] = [];
for (let turn = 0; turn < 600; turn++) {
  const rare: number[] | null = turn % 149 === 7 ? Keeping.from([4, 5]) : turn % 149 === 80 ? collection : null;
  const list = rare ?? plain;
  if (turn === 300) (switching as any).filter = function (this: number[], callback: any) { kept.push(callback); return Array.prototype.filter.call(this, callback); };
  const weights: number[] = turn % 83 === 11 ? (["3"] as any) : [2];
  const options: Options = { scale: 2, keep: turn % 61 === 9 };
  if (turn % 67 === 13) (options as any).scale = "4";
  const target: Target = turn % 101 === 3 ? emitter : turn % 103 === 50 ? untypedTarget : immediate;
  const line = [
    summed(list),
    scaled(list, turn & 3),
    above(list, 2),
    above(switching, 4),
    stopped(list, turn % 5 === 0 ? 2 : 50),
    weighted(list, weights),
    applied(plain, options),
    subscribed(target),
    rounds(rare ? [plain, rare, plain, rare] : [plain, plain]),
  ].join(" | ");
  const isShown = rare || turn % 83 === 11 || turn % 61 === 9 || turn % 67 === 13 || turn % 101 === 3 || turn % 103 === 50 || turn === 0 || turn === 299 || turn === 300 || turn === 599;
  if (isShown) lines.push(turn + ": " + line);
}
console.log(lines.join("\n"));
console.log("listeners left", emitter.listeners.length);
console.log("kept", kept.length);
console.log("called again", again(0));
console.log("and once more", again(kept.length - 20));

export {};
