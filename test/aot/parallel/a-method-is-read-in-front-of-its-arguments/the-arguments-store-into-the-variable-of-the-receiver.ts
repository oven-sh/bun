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
let slot = hide(new Slot());
function step(): number { log.push("step"); const next = new Slot(); next.tag = "next" + log.length; slot = hide(next); return 2; }
function bump(): string { return slot.of(step()); }
console.log(hide(bump)(), hide(bump)(), log.join(), slot.tag, slot.total);
