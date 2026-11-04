// The object is handed to code that no build has seen, which lays another getter.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function main() {
  const meter: Meter = { raw: 2, get value(): number { return this.raw * 2; } };
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(meter);
  (globalThis as any).handed = meter;
  (0, eval)("Object.defineProperty(handed, 'value', { get() { return 1000; }, configurable: true })");
  for (let i = 0; i < 300; i++) sum += read(meter);
  console.log(sum);
}
main();
