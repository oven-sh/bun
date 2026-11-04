// Freezing leaves the pair where it is: the getter answers, the setter runs, and its store into the frozen object throws.
type Meter = { raw: number; value: number };
function write(meter: Meter, next: number): string { try { meter.value = next; return "stored"; } catch (error) { return (error as Error).constructor.name; } }
function main() {
  let calls = 0;
  const meter: Meter = { raw: 1, get value(): number { return this.raw * 2; }, set value(next: number) { calls++; this.raw = next; } };
  const said: string[] = [];
  for (let i = 0; i < 200; i++) said.push(write(meter, i));
  Object.freeze(meter);
  for (let i = 0; i < 200; i++) said.push(write(meter, i));
  console.log(new Set(said).size, said[0], said[399], calls, meter.raw, meter.value);
}
main();
