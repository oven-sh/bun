// The getter reads a field of the same literal, and a descriptor makes that field an accessor.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function main() {
  const meter: Meter = { raw: 2, get value(): number { return this.raw * 2; } };
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(meter);
  let asked = 0;
  Object.defineProperty(meter, "raw", { get() { asked++; return 50; }, configurable: true });
  for (let i = 0; i < 300; i++) sum += read(meter);
  console.log(sum, asked, meter.raw);
}
main();
