// Unseen code takes the setter off the object that it got and hands it a text. The other object of the maker goes on getting numbers.
type Meter = { raw: number | string; value: number | string };
function make(raw: number): Meter { return { raw, get value(): number | string { return this.raw; }, set value(next: number | string) { this.raw = next; } }; }
function put(meter: Meter, next: number) { meter.value = next; }
function main() {
  const first = make(1), second = make(2);
  for (let i = 0; i < 300; i++) put(i & 1 ? first : second, i);
  (globalThis as any).handed = first;
  (0, eval)("Object.getOwnPropertyDescriptor(handed, 'value').set.call(handed, 'text')");
  console.log(typeof first.raw, typeof second.raw, first.value, second.value);
}
main();
