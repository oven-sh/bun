// The shape that is proven: one literal, both halves, nothing else ever done to the object. Another function gets the object as a parameter.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function write(meter: Meter, next: number) { meter.value = next; }
function main() {
  const meter: Meter = { raw: 0, get value(): number { return this.raw * 2; }, set value(next: number) { this.raw = next >> 1; } };
  let total = 0;
  for (let i = 0; i < 3000; i++) { meter.value = i & 1023; total += meter.value; }
  write(meter, 77);
  console.log(total, read(meter), meter.raw, meter.value);
}
main();
