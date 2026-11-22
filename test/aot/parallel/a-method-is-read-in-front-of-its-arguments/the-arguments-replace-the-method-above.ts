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
const spoil = new Function("Slot", "log", "Slot.prototype.of = function () { log.push('other'); return 'other'; };");
function step(): number { log.push("step"); spoil(Slot, log); return 2; }
function bump(): string { return slot.of(step()); }
console.log(hide(bump)(), hide(bump)(), log.join());
