// Every object is born with the pair, and one loses it.
type Gauge = { raw: number; value?: number };
function read(gauge: Gauge): number | undefined { return gauge.value; }
function main() {
  const gauge: Gauge = { raw: 5, get value(): number { return this.raw + 1; }, set value(next: number | undefined) { this.raw = next ?? 0; } };
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(gauge)!;
  delete gauge.value;
  const after: string[] = [];
  for (let i = 0; i < 300; i++) after.push(String(read(gauge)));
  gauge.value = 3;
  console.log(sum, new Set(after).size, after[0], gauge.raw, read(gauge), Object.keys(gauge).join());
}
main();
