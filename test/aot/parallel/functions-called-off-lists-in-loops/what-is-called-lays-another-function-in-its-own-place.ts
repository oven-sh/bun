const list: ((x: number) => number)[] = [
  x => {
    list[0] = y => y - 1;
    return x + 1;
  },
  x => {
    [list[0], list[1]] = [list[1], list[0]];
    return x * 2;
  },
];
function run(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += list[i & 1](i) + ";";
  return out;
}
console.log(run());
console.log(run());
