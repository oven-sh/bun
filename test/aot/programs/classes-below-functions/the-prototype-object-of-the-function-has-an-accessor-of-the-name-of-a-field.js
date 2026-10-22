function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
const log = [];
function Meter() { this.made = 1; }
Object.defineProperty(Meter.prototype, "extra", { get() { return "got"; }, set(v) { log.push("set " + v); }, configurable: true });
Object.defineProperty(Meter.prototype, "late", { get() { return "late got"; }, set(v) { log.push("late set " + v); }, configurable: true });
class Fine extends Meter { extra = 2; constructor() { super(); this.late = 3; } }
const fine = new Fine();
console.log(show(fine), fine.extra, fine.late, log.join());
