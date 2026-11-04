// No setter lies there: strict code throws, and the getter answers as before.
type Gauge = { raw: number; value: number };
function store(gauge: Gauge, next: number): string {
  try { gauge.value = next; return "stored"; } catch (error) { return (error as Error).constructor.name; }
}
function main() {
  const gauge: Gauge = { raw: 4, get value(): number { return this.raw + 1; } };
  const said: string[] = [];
  for (let i = 0; i < 300; i++) said.push(store(gauge, i));
  console.log(new Set(said).size, said[0], gauge.value, gauge.raw, Object.keys(gauge).join());
}
main();
