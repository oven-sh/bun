function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(text: string, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += text.charCodeAt(turn);
  return sum;
}
const idle = joined(JSON.parse('"ab"'), 10).slice(1), read = joined(JSON.parse('"cd"'), 10).slice(1);
console.log(scan(idle, Number("0")), scan(read, Number("7")));
