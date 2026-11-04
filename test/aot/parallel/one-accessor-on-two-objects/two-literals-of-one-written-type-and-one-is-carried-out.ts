// Two literals under one written type, each with its own functions. One may be carried out in an arm that does not run; one store and one read meet both.
type Meter = { raw: number; value: number; seen?: number };
function put(meter: Meter, next: number) { meter.value = next; return typeof meter.seen; }
function read(meter: Meter): number { return meter.value; }
function main() {
  const kept: Meter = { raw: 1, get value(): number { return this.raw * 2; }, set value(next: number) { this.seen = next; this.raw = next; } };
  const carried: Meter = { raw: 1, get value(): number { return -this.raw; }, set value(next: number) { this.seen = next; this.raw = next + 1; } };
  let note = "";
  try { JSON.parse(process.argv[2] ?? "{}"); } catch (error: any) { error.context = carried; note = error.toString(); }
  let sum = 0, said = "";
  for (let i = 0; i < 300; i++) { const meter = i & 1 ? kept : carried; const kind = put(meter, i); if (i < 2) said += kind; sum += read(meter) * (i & 1 ? 1000 : 1); }
  console.log(sum, said, kept.raw, carried.raw, note.length);
}
main();
