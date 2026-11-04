// The accessors have the literal as their home object.
const base = { get value() { return this.raw + 1; }, set value(next) { this.raw = next * 10; } };
function read(object) { return object.value; }
function main() {
  const meter = { __proto__: base, raw: 1, get value() { return super.value * 2; }, set value(next) { super.value = next + 1; } };
  let sum = 0;
  for (let i = 0; i < 300; i++) { meter.value = i; sum += read(meter); }
  console.log(sum, meter.raw);
}
main();
