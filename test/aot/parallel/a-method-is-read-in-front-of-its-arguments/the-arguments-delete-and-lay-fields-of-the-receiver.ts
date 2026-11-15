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
const spoil = new Function("slot", "turn", "if (turn === 0) { delete slot.tag; slot.more = 1; } else slot.tag = 'again';");
let turn = 0;
function step(): number { log.push("step"); spoil(slot, turn++); return 2; }
function bump(): string { return slot.of(step()); }
console.log(hide(bump)(), hide(bump)(), hide(bump)(), log.join(), Object.keys(slot).join());
