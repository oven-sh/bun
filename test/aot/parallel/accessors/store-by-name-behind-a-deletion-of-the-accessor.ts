// The accessor is deleted, and the next store creates a value.
type Meter = { raw: number; value?: number };
function put(meter: Meter, next: number) { meter.value = next; }
function main() {
  const meter: Meter = { raw: 0, get value(): number { return this.raw + 100; }, set value(next: number | undefined) { this.raw = next ?? -1; } };
  for (let i = 0; i < 300; i++) put(meter, i);
  console.log(meter.raw, meter.value);
  delete meter.value;
  console.log(meter.raw, meter.value, "value" in meter);
  for (let i = 0; i < 300; i++) put(meter, i);
  console.log(meter.raw, meter.value, typeof Object.getOwnPropertyDescriptor(meter, "value")!.get);
}
main();
