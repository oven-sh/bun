// Two literals under one written type: one lays the pair, the other lists a value. One function stores into both and reads both.
type Meter = { raw: number; value: number };
function bump(meter: Meter, by: number): number { meter.value = meter.value + by; return meter.value; }
function main() {
  const computed: Meter = { raw: 1, get value(): number { return this.raw * 10; }, set value(next: number) { this.raw = next / 10 + 1; } };
  const plain: Meter = { raw: 1, value: 10 };
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += bump(i & 1 ? computed : plain, 1);
  console.log(sum, computed.raw, computed.value, plain.raw, plain.value);
}
main();
