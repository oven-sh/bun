function pick(n: number) {
  switch (n) {
    case 174: return "0:174";
    case 175: return "1:175";
    case 176: return "2:176";
    case 177: return "3:177";
    case 178: return "4:178";
    case 179: return "5:179";
    case 180: return "6:180";
    case 181: return "7:181";
    case 182: return "8:182";
    case 185: return "9:185";
    case 186: return "10:186";
    case 195: return "11:195";
    case 201: return "12:201";
    case 219: return "13:219";
    case 220: return "14:220";
    case 242: return "15:242";
    case 249: return "16:249";
    case 250: return "17:250";
    case 251: return "18:251";
    case 263: return "19:263";
    case 266: return "20:266";
    case 268: return "21:268";
    case 270: return "22:270";
    case 300: return "23:300";
    case 308: return "24:308";
    case 318: return "25:318";
    case 324: return "26:324";
    case 339: return "27:339";
    case 341: return "28:341";
    case 347: return "29:347";
    default: return "none";
  }
}
const said: string[] = [];
for (const probe of [-1, 0, 1, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 168, 169, 170, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 200, 201, 202, 203, 204, 210, 211, 216, 217, 218, 219, 220, 221, 225, 226, 232, 233, 234, 235, 236, 241, 242, 243, 246, 247, 248, 249, 250, 251, 252, 253, 254, 257, 258, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 278, 279, 281, 282, 283, 284, 285, 286, 291, 292, 299, 300, 301, 302, 307, 308, 309, 315, 316, 317, 318, 319, 322, 323, 324, 325, 330, 331, 333, 334, 338, 339, 340, 341, 342, 346, 347, 348, 354, 355, 356, 357, 362, 363, 0.5, -0, NaN, Infinity, -Infinity, 4294967296 + 174]) said.push(pick(probe as never));
console.log(said.join(" "));
