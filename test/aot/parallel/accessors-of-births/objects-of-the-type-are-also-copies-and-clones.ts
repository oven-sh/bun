// Copies of the object under the same written type hold a value where the original holds the pair.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function main() {
  const computed: Meter = { raw: 4, get value(): number { return this.raw * 2; } };
  const spread: Meter = { ...computed }, assigned: Meter = Object.assign({} as Meter, computed), cloned: Meter = structuredClone(computed);
  computed.raw = 10; spread.raw = 20; assigned.raw = 30; cloned.raw = 40;
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(computed) + read(spread) * 100 + read(assigned) * 10000 + read(cloned) * 1000000;
  console.log(sum);
}
main();
