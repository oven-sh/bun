function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(text: string, from: number): number {
  let sum = 0;
  for (let i = from; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(scan(idle, idle.length), scan(idle, idle.length + 1), scan(read, Number("0")), scan(read, read.length - 1));
