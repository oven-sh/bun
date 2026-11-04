// The object lies in a list beside objects of other shapes, and a function that knows none of them defines on whatever it is handed.
type Meter = { raw: number; value: number };
function read(meter: Meter): number { return meter.value; }
function redefine(things: object[], at: number) { Object.defineProperty(things[at], "value", { value: -7, configurable: true }); }
function main() {
  const meter: Meter = { raw: 2, get value(): number { return this.raw * 2; } };
  const things: object[] = [{ a: 1 }, meter, [1, 2], new Map(), { b: "x", value: 1 }];
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(meter);
  redefine(things, 1);
  for (let i = 0; i < 300; i++) sum += read(meter);
  console.log(sum);
}
main();
