const log: string[] = [];
const hide = new Function("value", "return value") as <V>(value: V) => V;
class Slot {
  total = 0;
  tag = "slot";
  of(step: number): string {
    this.total += step;
    log.push("of:" + this.tag + ":" + this.total);
    return this.tag + this.total;
  }
}
let slot: Slot = hide(new Slot());
function step(): number { log.push("step"); return 2; }
function bump(): string { try { return String(slot.of(step())); } catch (error) { return (error as Error).name; } }
console.log(hide(bump)());
for (const text of ["({ of(n) { return 'plain' + n; } })", "new (class Other { of(n) { return 'other' + n; } })()", "new Proxy({}, { get(t, k) { return n => 'proxy' + String(k) + n; } })", "({ of: 5 })", "({})", "7", "'text'", "Object.create({ of(n) { return 'above' + n; } })"]) { slot = new Function("return " + text)(); console.log(hide(bump)()); }
console.log(log.join());
