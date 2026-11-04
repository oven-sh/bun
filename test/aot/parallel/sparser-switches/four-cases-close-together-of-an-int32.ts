function pick(n: number) {
  switch (n | 0) {
    case 10: return "0:10";
    case 13: return "1:13";
    case 40: return "2:40";
    case 41: return "3:41";
    default: return "none";
  }
}
const said: string[] = [];
for (const probe of [-7, -6, -4, -3, -1, 0, 1, 9, 10, 11, 12, 13, 14, 23, 24, 25, 26, 28, 29, 39, 40, 41, 42, 55, 56, 57]) said.push(pick(probe as never));
console.log(said.join(" "));
