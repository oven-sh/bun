function pick(n: number) {
  switch (n) {
    case 0: return "0:0";
    case 31: return "1:31";
    case 47: return "2:47";
    case 63: return "3:63";
    default: return "none";
  }
}
const said: string[] = [];
for (const probe of [-17, -16, -1, 0, 1, 14, 15, 16, 30, 31, 32, 46, 47, 48, 62, 63, 64, 78, 79, 0.5, -0, NaN, Infinity, -Infinity, 4294967296 + 0]) said.push(pick(probe as never));
console.log(said.join(" "));
