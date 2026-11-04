// An object that stands below the literal finds the pair above it, and is `this`.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function write(meter: Meter, next: number) { meter.value = next; }
function main() {
  const meter: Meter = { raw: 1, get value(): number { return this.raw * 2; }, set value(next: number) { this.raw = next; } };
  const heir: Meter = Object.create(meter);
  let sum = 0;
  for (let i = 0; i < 300; i++) { write(i & 1 ? meter : heir, i); sum += read(meter) * 1000 + read(heir); }
  console.log(sum, meter.raw, heir.raw, Object.hasOwn(heir, "raw"), Object.hasOwn(heir, "value"));
}
main();
