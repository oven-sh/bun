function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
async function scan(text: string, turns: number): Promise<number> {
  let sum = await Promise.resolve(1);
  for (let turn = 0; turn < turns; turn++) sum += text.charCodeAt(turn);
  return sum + (await Promise.resolve(text.length));
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(await scan(idle, Number("0")), await scan(read, Number("7")));
