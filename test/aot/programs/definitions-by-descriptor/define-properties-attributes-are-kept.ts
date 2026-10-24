// What the descriptors say of attributes holds at run time: neither listed, nor defined anew, nor deleted.
function Meter(this: any) { this.value = 1; }
Object.defineProperties(Meter.prototype, { twice: { enumerable: false, get(this: any) { return this.value * 2; } } });
const meter = new (Meter as any)();
let score = 0;
for (const name in meter) if (name === "twice") score += 1;
try { Object.defineProperty(Meter.prototype, "twice", { value: 9 }); score += 10; } catch { score += 100; }
if (!Reflect.deleteProperty(Meter.prototype, "twice")) score += 1000;
console.log(score + meter.twice * 10000);
