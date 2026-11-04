// A store on an object that stands below the literal finds the setter above and runs it with the heir.
type Meter = { raw: number; value: number };
function put(meter: Meter, next: number) { meter.value = next; }
function main() {
  const meter: Meter = { raw: 0, get value(): number { return this.raw * 2; }, set value(next: number) { this.raw = next; } };
  const heir: Meter = Object.create(meter);
  for (let i = 0; i < 300; i++) { put(meter, i); put(heir, i + 1000); }
  console.log(meter.raw, meter.value, heir.raw, heir.value, Object.keys(heir).join(), Object.hasOwn(heir, "value"));
}
main();
