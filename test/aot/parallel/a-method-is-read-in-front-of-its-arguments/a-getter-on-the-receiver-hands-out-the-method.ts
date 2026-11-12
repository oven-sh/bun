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
const slot = hide(new Slot());
Object.defineProperty(slot, "of", { get() { log.push("get"); return (n: number) => { log.push("got" + n); return "got"; }; }, configurable: true });
function step(): number { log.push("step"); return 2; }
function bump(): string { return slot.of(step()); }
console.log(hide(bump)(), hide(bump)(), log.join());
