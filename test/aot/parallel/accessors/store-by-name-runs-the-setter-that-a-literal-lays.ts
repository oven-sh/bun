// The body that makes the object stores under the name of its accessor, in a loop and outside of one.
function main() {
  const meter = { raw: 0, get value(): number { return this.raw * 2; }, set value(next: number) { this.raw = next >> 1; } };
  let total = 0;
  for (let i = 0; i < 2000; i++) { meter.value = i & 1023; total += meter.value; }
  meter.value = 9;
  console.log(total, meter.raw, meter.value, Object.keys(meter).join(), JSON.stringify(meter));
  const found = Object.getOwnPropertyDescriptor(meter, "value")!;
  console.log(typeof found.get, typeof found.set, found.enumerable, found.configurable, "value" in found);
}
main();
