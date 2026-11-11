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
let turn = 0;
function step(): number { log.push("step"); if (turn++ & 1) throw new RangeError("odd"); return 2; }
function bump(): string { try { return slot.of(step()); } catch (error) { return (error as Error).name; } }
console.log(hide(bump)(), hide(bump)(), hide(bump)(), log.join());
