function pick(n: unknown) {
  switch (n) {
    case -100: return "0:-100";
    case -90: return "1:-90";
    case -75: return "2:-75";
    case -61: return "3:-61";
    case -60: return "4:-60";
    case -3: return "5:-3";
    case 0: return "6:0";
    case 4: return "7:4";
    default: return "none";
  }
}
const said: string[] = [];
for (const probe of [-117, -116, -107, -106, -101, -100, -99, -92, -91, -90, -89, -85, -84, -78, -77, -76, -75, -74, -62, -61, -60, -59, -46, -45, -44, -20, -19, -17, -16, -13, -12, -4, -3, -2, -1, 0, 1, 3, 4, 5, 12, 13, 15, 16, 19, 20, 0.5, -0, NaN, Infinity, -Infinity, 4294967296 + -100, "10", null, undefined, true, 10n, {}]) said.push(pick(probe as never));
console.log(said.join(" "));
