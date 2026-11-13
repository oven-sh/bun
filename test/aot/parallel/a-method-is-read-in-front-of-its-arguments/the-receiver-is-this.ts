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
const spoil = new Function("Wide", "log", "Wide.prototype.of = function () { log.push('late'); return 'late'; };");
class Wide extends Slot {
  step(): number { log.push("step"); if (this.total > 2) spoil(Wide, log); return 2; }
  bump(): string { return this.of(this.step()); }
}
const wide = hide(new Wide());
console.log(wide.bump(), wide.bump(), wide.bump(), wide.bump(), log.join());
