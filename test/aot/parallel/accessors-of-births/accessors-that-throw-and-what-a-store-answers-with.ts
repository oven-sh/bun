// A getter and a setter that throw, a setter that returns something, and the value of the assignment.
type Meter = { raw: number; limit: number; value: number };
function step(meter: Meter, next: number): string {
  try { const answered = (meter.value = next); return String(answered) + ":" + meter.value; } catch (error) { return (error as Error).message; }
}
function main() {
  const meter: Meter = { raw: 0, limit: 5,
    get value(): number { if (this.raw > this.limit) throw new RangeError("read over " + this.limit); return this.raw; },
    set value(next: number) { if (next < 0) throw new RangeError("stored " + next); this.raw = next; return (99 as unknown) as void; } };
  const said: string[] = [];
  for (let i = -2; i < 9; i++) said.push(step(meter, i));
  console.log(said.join(" "));
}
main();
