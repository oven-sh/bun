const list: ((x: number) => number)[] = [x => x + 1, x => x * 2];
const spare: ((x: number) => number)[] = [x => x - 100, x => x * -1];
function run(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += list[i & 1](((list[i & 1] = spare[i & 1]), i)) + ";";
  return out;
}
console.log(run());
console.log(run());
