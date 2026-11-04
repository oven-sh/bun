// Two literals under one written type. One lays the getter alone, the other the setter alone: a read off the second gives undefined, a store into the first throws.
type Gauge = { raw: number; value: number | undefined };
function read(gauge: Gauge): number | undefined { return gauge.value; }
function write(gauge: Gauge, next: number): string { try { gauge.value = next; return "stored"; } catch (error) { return (error as Error).constructor.name; } }
function main() {
  const readable: Gauge = { raw: 5, get value(): number | undefined { return this.raw + 1; } };
  const writable: Gauge = { raw: 5, set value(next: number | undefined) { this.raw = next ?? 0; } };
  const said: string[] = [];
  for (let i = 0; i < 400; i++) { const gauge = i & 1 ? readable : writable; said.push(write(gauge, i) + ":" + String(read(gauge))); }
  console.log(said.slice(0, 4).join(), said.slice(-2).join(), readable.raw, writable.raw);
}
main();
