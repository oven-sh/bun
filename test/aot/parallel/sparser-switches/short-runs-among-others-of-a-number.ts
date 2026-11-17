function pick(n: number) {
  switch (n) {
    case -70000: return "0:-70000";
    case 10: return "1:10";
    case 13: return "2:13";
    case 40: return "3:40";
    case 41: return "4:41";
    case 8232: return "5:8232";
    case 8233: return "6:8233";
    case 8234: return "7:8234";
    case 8290: return "8:8290";
    case 1048576: return "9:1048576";
    default: return "none";
  }
}
const said: string[] = [];
for (const probe of [-70017, -70016, -70001, -70000, -69999, -69985, -69984, -7, -6, -4, -3, -1, 0, 1, 9, 10, 11, 12, 13, 14, 23, 24, 25, 26, 28, 29, 39, 40, 41, 42, 55, 56, 57, 8215, 8216, 8217, 8218, 8231, 8232, 8233, 8234, 8235, 8247, 8248, 8249, 8250, 8273, 8274, 8289, 8290, 8291, 8305, 8306, 1048559, 1048560, 1048575, 1048576, 1048577, 1048591, 1048592, 0.5, -0, NaN, Infinity, -Infinity, 4294967296 + -70000]) said.push(pick(probe as never));
console.log(said.join(" "));
