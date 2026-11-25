function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(text: string, turns: number, stop: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    sum += text.charCodeAt(turn);
    if (turn === stop) break;
  }
  return sum * 1000 + text.charCodeAt(1);
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(scan(idle, Number("0"), Number("0")), scan(read, Number("9"), Number("0")), scan(read, Number("9"), Number("3")));
