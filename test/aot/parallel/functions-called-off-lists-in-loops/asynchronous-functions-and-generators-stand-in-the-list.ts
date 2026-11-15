const list: any[] = [async (x: number) => x + 1, (x: number) => x * 2];
async function run(): Promise<string> {
  let out = "";
  for (let i = 0; i < 4; i++) out += (await list[i & 1](i)) + ";";
  return out;
}
console.log(await run());
