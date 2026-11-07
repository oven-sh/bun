// One of them is written as a number and takes anything; what they hold when the counter leaves the 32-bit integers is what the closure reads.
const shown: string[] = [];
function show(value: unknown): void {
  shown.push(Object.is(value, -0) ? "-0" : String(value));
}
function stride(at: number): number {
  return (at & 1) + 1073741823;
}
const handedOn = (value: any): any => [value][JSON.parse("0")];
function hops(from: number, first: any): string {
  let last = -1, mixed: number = first, turns = 0;
  const read = () => last + "|" + mixed + "|" + turns;
  for (let at = from; at < 5000000000; at += stride(at)) {
    mixed = mixed + 1;
    last = at;
    turns++;
  }
  return read();
}
for (const first of [10, "t", 0.25, undefined, null, { valueOf() { return 5; } }]) {
  for (const from of [0, 1, 0.5, -0, 2147483647, 4999999999, 6000000000]) show(hops(from, handedOn(first)));
}
console.log(shown.join(" "));
