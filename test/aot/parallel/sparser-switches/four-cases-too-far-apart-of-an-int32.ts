function pick(n: number) {
  switch (n | 0) {
    case 0: return "0:0";
    case 32: return "1:32";
    case 64: return "2:64";
    case 96: return "3:96";
    default: return "none";
  }
}
const said: string[] = [];
for (const probe of [-17, -16, -1, 0, 1, 15, 16, 31, 32, 33, 47, 48, 63, 64, 65, 79, 80, 95, 96, 97, 111, 112]) said.push(pick(probe as never));
console.log(said.join(" "));
