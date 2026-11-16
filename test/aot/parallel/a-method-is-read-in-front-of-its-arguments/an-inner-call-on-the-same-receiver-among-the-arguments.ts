const hide = new Function("value", "return value") as <V>(value: V) => V;
class Slot { total = 0; of(a: number, b: number): number { this.total += a + b; return this.total; } half(a: number): number { return a >> 1; } }
const slot = hide(new Slot());
function step(): number { return hide(4); }
function bump(): number { return slot.of(slot.half(step()), step()); }
console.log(hide(bump)(), hide(bump)());
