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
let slot: Slot | null | undefined = hide(new Slot());
function step(): number { log.push("step"); return 2; }
function bump(): string { try { return slot!.of(step()); } catch (error) { return (error as Error).name; } }
console.log(hide(bump)()); slot = hide(null); console.log(hide(bump)()); slot = hide(undefined); console.log(hide(bump)(), log.join());
