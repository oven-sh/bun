// One written type: a literal that lays the pair, and a copy of it by spread, which holds a value. One store and one read meet both.
type Meter = { raw: number; value: number };
function put(meter: Meter, next: number) { meter.value = next; }
function read(meter: Meter): number { return meter.value; }
function main() {
  const computed: Meter = { raw: 4, get value(): number { return this.raw * 2; }, set value(next: number) { this.raw = next; } };
  const copy: Meter = { ...computed };
  let sum = 0;
  for (let i = 0; i < 300; i++) { put(i & 1 ? computed : copy, i); sum += read(computed) * 1000 + read(copy); }
  console.log(sum, computed.raw, copy.raw);
}
main();
