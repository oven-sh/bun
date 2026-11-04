// A key that is computed stands in front of the accessors, a prototype is written in the literal, and the getter needs its closure: wherever the run time lays the pair, the access finds it.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function write(meter: Meter, next: number) { meter.value = next; }
function make(key: string, bias: number): Meter {
  return { __proto__: { inherited: 1 }, [key]: 1, raw: 2, get value(): number { return this.raw * 2 + bias; }, set value(next: number) { this.raw = next + bias; } } as Meter;
}
function main() {
  const first = make("extra", 1), second = make("other", 2);
  let sum = 0;
  for (let i = 0; i < 300; i++) { write(i & 1 ? first : second, i); sum += read(first) + read(second); }
  console.log(sum, Object.keys(first).join(), Object.keys(second).join(), (first as any).inherited);
}
main();
