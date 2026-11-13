function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(text: string, turns: number): number {
  let unit = 0, sum = 0;
  for (let i = 0; (unit = text.charCodeAt(i)), i < turns; i++) sum += unit;
  return sum * 1000 + unit;
}
const once = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(scan(once, Number("0")), scan(read, Number("12")));
