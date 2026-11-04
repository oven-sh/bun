// The written type of the literal is also what a text is parsed as: those objects have a value under the name.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function main() {
  const computed: Meter = { raw: 4, get value(): number { return this.raw * 2; } };
  const parsed: Meter = JSON.parse('{"raw":4,"value":100}');
  const list: Meter[] = JSON.parse('[{"raw":1,"value":7},{"raw":2,"value":9}]');
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(computed) + read(parsed) * 1000 + read(list[i & 1]) * 1000000;
  console.log(sum, typeof Object.getOwnPropertyDescriptor(parsed, "value")!.get);
}
main();
