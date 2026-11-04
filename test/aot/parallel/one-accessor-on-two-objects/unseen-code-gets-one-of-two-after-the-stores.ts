// Two objects out of one maker. Unseen code gets the first AFTER the stores and lays other halves on it; the reads behind that meet both.
type Meter = { raw: number; value: number };
function make(raw: number): Meter { return { raw, get value(): number { return this.raw * 2; }, set value(next: number) { this.raw = next; } }; }
function put(meter: Meter, next: number) { meter.value = next; }
function read(meter: Meter): number { return meter.value; }
function main() {
  const first = make(1), second = make(2);
  let sum = 0;
  for (let i = 0; i < 300; i++) { put(i & 1 ? first : second, i); sum += read(first) + read(second); }
  (globalThis as any).handed = first;
  (0, eval)("Object.defineProperty(handed, 'value', { get() { return 1000; }, set(next) { this.raw = -next; }, configurable: true })");
  console.log(sum, read(first), read(second), first.raw, second.raw);
}
main();
