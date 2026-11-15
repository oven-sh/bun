function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(one: string, other: string, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += one.charCodeAt(turn) * other.charCodeAt(turn + 1);
  return sum;
}
const idle = joined(JSON.parse('"ab"'), 10), still = joined(JSON.parse('"ef"'), 10), read = joined(JSON.parse('"cd"'), 10), too = joined(JSON.parse('"gh"'), 10);
console.log(scan(idle, still, Number("0")), scan(read, too, Number("5")));
