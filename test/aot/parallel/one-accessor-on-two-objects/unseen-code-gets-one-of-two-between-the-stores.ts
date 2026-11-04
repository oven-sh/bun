// Two objects out of one maker. Unseen code gets the first BETWEEN the stores and lays other halves on it; one store meets both.
type Meter = { raw: number; value: number };
function make(raw: number): Meter { return { raw, get value(): number { return this.raw * 2; }, set value(next: number) { this.raw = next; } }; }
function put(meter: Meter, next: number) { meter.value = next; }
function main() {
  const first = make(1), second = make(2);
  let sum = 0;
  for (let i = 0; i < 300; i++) { put(i & 1 ? first : second, i); sum += first.value + second.value; }
  (globalThis as any).handed = first;
  (0, eval)("Object.defineProperty(handed, 'value', { get() { return 1000; }, set(next) { this.raw = -next; }, configurable: true })");
  for (let i = 0; i < 300; i++) { put(i & 1 ? first : second, i); sum += first.value + second.value; }
  console.log(sum, first.raw, second.raw);
}
main();
