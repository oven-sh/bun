// The getter reads a field of the same literal, and the program deletes that field.
type Meter = { raw?: number; value: string };
function read(meter: Meter): string { return meter.value; }
function main() {
  const meter: Meter = { raw: 2, get value(): string { return "raw is " + this.raw; } };
  const said: string[] = [];
  for (let i = 0; i < 300; i++) said.push(read(meter));
  delete meter.raw;
  for (let i = 0; i < 300; i++) said.push(read(meter));
  console.log(new Set(said).size, said[0], said[599], "raw" in meter);
}
main();
