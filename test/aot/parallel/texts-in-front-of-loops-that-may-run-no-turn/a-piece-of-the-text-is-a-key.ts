function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function found(text: string, turns: number): number {
  const table = new Map<string, number>(JSON.parse('[["cd",1],["ab",5]]'));
  let n = 0;
  for (let i = 0; i < turns; i++) n += table.get(text.slice(0, 2)) ?? 0;
  return n;
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(found(idle, Number("0")), found(read, Number("3")));
