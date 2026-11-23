// Two literals under one written type, each with its own functions: which one runs hangs on the object.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function write(meter: Meter, next: number) { meter.value = next; }
function main() {
  const doubled: Meter = { raw: 1, get value(): number { return this.raw * 2; }, set value(next: number) { this.raw = next; } };
  const negated: Meter = { raw: 1, get value(): number { return -this.raw; }, set value(next: number) { this.raw = next + 1; } };
  let sum = 0;
  for (let i = 0; i < 300; i++) { const meter = i & 1 ? doubled : negated; write(meter, i); sum += read(meter) * (i & 1 ? 1000 : 1); }
  console.log(sum, doubled.raw, negated.raw);
}
main();
