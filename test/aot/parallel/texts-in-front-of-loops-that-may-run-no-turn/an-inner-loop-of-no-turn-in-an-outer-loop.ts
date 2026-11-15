function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(text: string, rows: number, columns: number): number {
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) sum += text.charCodeAt(row + column);
  }
  return sum;
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(scan(idle, Number("0"), Number("4")), scan(read, Number("3"), Number("0")), scan(read, Number("3"), Number("4")));
