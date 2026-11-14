// Two literals under one written type. One lays the getter, the other leaves the name out: a read off it finds nothing.
type Gauge = { raw: number; value?: number };
function read(gauge: Gauge): number | undefined { return gauge.value; }
function main() {
  const computed: Gauge = { raw: 5, get value(): number { return this.raw + 1; } };
  const bare: Gauge = { raw: 5 };
  const said: string[] = [];
  for (let i = 0; i < 400; i++) said.push(String(read(i % 3 ? computed : bare)));
  console.log(said.slice(0, 6).join(), new Set(said).size, "value" in bare, "value" in computed);
}
main();
