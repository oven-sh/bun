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
const spoil = new Function("slot", "log", "Object.setPrototypeOf(slot, { of() { log.push('below'); return 'below'; } });");
function step(): number { log.push("step"); spoil(slot, log); return 2; }
function bump(): string { return slot.of(step()); }
console.log(hide(bump)(), hide(bump)(), log.join());
