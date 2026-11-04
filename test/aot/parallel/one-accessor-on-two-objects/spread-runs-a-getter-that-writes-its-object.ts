// A spread runs the getter with the source as `this`, and the getter counts in a field that the body has just read.
type Meter = { raw: number; reads: number; value: number };
function main() {
  const meter: Meter = { raw: 3, reads: 0, get value(): number { this.reads++; return this.raw; } };
  let sum = 0;
  for (let i = 0; i < 300; i++) { const before = meter.reads; const copy = { ...meter }; sum += (meter.reads - before) * 1000 + copy.value + copy.reads; }
  console.log(sum, meter.reads);
}
main();
