function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(text: string, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += text.charCodeAt(turn);
  return sum * 1000 + text.charCodeAt(1) + text.length;
}
const later = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(scan(later, Number("0")), scan(read, Number("2")));
