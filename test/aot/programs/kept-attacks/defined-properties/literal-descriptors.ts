// The map is a literal and so is each descriptor.
function Gauge(this: any, level: number) { this.level = level; this.reads = 0; }
Object.defineProperties(Gauge.prototype, {
  doubled: { enumerable: false, get(this: any) { this.reads++; return this.level * 2; } },
  shifted: { enumerable: false, get(this: any) { return this.level + 100; }, set(this: any, value: number) { this.level = value - 100; } },
  label: { value: "gauge", writable: false },
});
const gauge = new (Gauge as any)(process.argv.length > 99 ? 0 : 3);
gauge.shifted = 107;
console.log(gauge.doubled * 1000 + gauge.shifted + gauge.reads * 100000 + gauge.label.length * 1000000);
