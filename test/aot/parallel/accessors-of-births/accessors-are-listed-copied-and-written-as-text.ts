// Whoever lists, copies or writes the object runs the getter as ever.
function main() {
  let reads = 0;
  const meter = { raw: 3, get value(): number { reads++; return this.raw * 2; }, set value(next: number) { this.raw = next; } };
  let sum = 0;
  for (let i = 0; i < 100; i++) { meter.value = i; sum += meter.value; }
  const copy = { ...meter }, assigned = Object.assign({}, meter);
  console.log(sum, JSON.stringify(meter), Object.entries(meter).join(";"), Object.values(copy).join(), typeof Object.getOwnPropertyDescriptor(copy, "value")!.get, assigned.value, reads);
  Object.assign(meter, { value: 500 });
  const { value, ...rest } = meter;
  console.log(meter.raw, value, JSON.stringify(rest), reads);
}
main();
