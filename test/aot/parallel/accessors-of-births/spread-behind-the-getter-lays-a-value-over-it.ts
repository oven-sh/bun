// `{ get value() { .. }, ...other }`: what is copied in defines a value over the accessor.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function make(other: Partial<Meter>): Meter { return { raw: 2, get value(): number { return this.raw * 2; }, ...other }; }
function main() {
  const kept = make({}), covered = make({ value: 9 });
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(kept) * 1000 + read(covered);
  console.log(sum, typeof Object.getOwnPropertyDescriptor(kept, "value")!.get, typeof Object.getOwnPropertyDescriptor(covered, "value")!.get);
}
main();
