function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function hits(text: string, turns: number): number {
  let n = 0;
  for (let i = 0; i < turns; i++) n += text.startsWith("cd") ? 1 : 0;
  return n;
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(hits(idle, Number("0")), hits(read, Number("3")));
