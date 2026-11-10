function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(text: string, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += text.charCodeAt(i) + text.charCodeAt(1);
  return sum;
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(scan(idle, Number("0")), scan(read, Number("3")), scan(JSON.parse('"z"'), Number("2")));
