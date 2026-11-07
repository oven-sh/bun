// RUN: lower
// STATISTIC: CheckerQueries <= 19500

// Which files tsconfig.json includes changes the numbers of the files, not that.

// FILE: main.ts
import type { Wide } from "./shapes";
import { sum0 } from "./a0";
const wide: Wide = { f0: 0, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6, f7: 7, f8: 8, f9: 9, f10: 10, f11: 11, f12: 12, f13: 13, f14: 14, f15: 15, f16: 16, f17: 17, f18: 18, f19: 19, f20: 20, f21: 21, f22: 22, f23: 23, f24: 24, f25: 25, f26: 26, f27: 27, f28: 28, f29: 29, f30: 30, f31: 31, f32: 32, f33: 33, f34: 34, f35: 35, f36: 36, f37: 37, f38: 38, f39: 39, f40: 40, f41: 41, f42: 42, f43: 43, f44: 44, f45: 45, f46: 46, f47: 47, f48: 48, f49: 49, f50: 50, f51: 51, f52: 52, f53: 53, f54: 54, f55: 55, f56: 56, f57: 57, f58: 58, f59: 59, f60: 60, f61: 61, f62: 62, f63: 63, f64: 64, f65: 65, f66: 66, f67: 67, f68: 68, f69: 69, f70: 70, f71: 71, f72: 72, f73: 73, f74: 74, f75: 75, f76: 76, f77: 77, f78: 78, f79: 79, f80: 80, f81: 81, f82: 82, f83: 83, f84: 84, f85: 85, f86: 86, f87: 87, f88: 88, f89: 89, f90: 90, f91: 91, f92: 92, f93: 93, f94: 94, f95: 95, f96: 96, f97: 97, f98: 98, f99: 99, f100: 100, f101: 101, f102: 102, f103: 103, f104: 104, f105: 105, f106: 106, f107: 107, f108: 108, f109: 109, f110: 110, f111: 111, f112: 112, f113: 113, f114: 114, f115: 115, f116: 116, f117: 117, f118: 118, f119: 119, f120: 120, f121: 121, f122: 122, f123: 123, f124: 124, f125: 125, f126: 126, f127: 127, f128: 128, f129: 129, f130: 130, f131: 131, f132: 132, f133: 133, f134: 134, f135: 135, f136: 136, f137: 137, f138: 138, f139: 139, f140: 140, f141: 141, f142: 142, f143: 143, f144: 144, f145: 145, f146: 146, f147: 147, f148: 148, f149: 149, f150: 150, f151: 151, f152: 152, f153: 153, f154: 154, f155: 155, f156: 156, f157: 157, f158: 158, f159: 159, f160: 160, f161: 161, f162: 162, f163: 163, f164: 164, f165: 165, f166: 166, f167: 167, f168: 168, f169: 169, f170: 170, f171: 171, f172: 172, f173: 173, f174: 174, f175: 175, f176: 176, f177: 177, f178: 178, f179: 179, f180: 180, f181: 181, f182: 182, f183: 183, f184: 184, f185: 185, f186: 186, f187: 187, f188: 188, f189: 189, f190: 190, f191: 191, f192: 192, f193: 193, f194: 194, f195: 195, f196: 196, f197: 197, f198: 198, f199: 199, f200: 200, f201: 201, f202: 202, f203: 203, f204: 204, f205: 205, f206: 206, f207: 207, f208: 208, f209: 209, f210: 210, f211: 211, f212: 212, f213: 213, f214: 214, f215: 215, f216: 216, f217: 217, f218: 218, f219: 219, f220: 220, f221: 221, f222: 222, f223: 223, f224: 224, f225: 225, f226: 226, f227: 227, f228: 228, f229: 229, f230: 230, f231: 231, f232: 232, f233: 233, f234: 234, f235: 235, f236: 236, f237: 237, f238: 238, f239: 239, f240: 240, f241: 241, f242: 242, f243: 243, f244: 244, f245: 245, f246: 246, f247: 247, f248: 248, f249: 249, f250: 250, f251: 251, f252: 252, f253: 253, f254: 254, f255: 255, f256: 256, f257: 257, f258: 258, f259: 259, f260: 260, f261: 261, f262: 262, f263: 263, f264: 264, f265: 265, f266: 266, f267: 267, f268: 268, f269: 269, f270: 270, f271: 271, f272: 272, f273: 273, f274: 274, f275: 275, f276: 276, f277: 277, f278: 278, f279: 279, f280: 280, f281: 281, f282: 282, f283: 283, f284: 284, f285: 285, f286: 286, f287: 287, f288: 288, f289: 289, f290: 290, f291: 291, f292: 292, f293: 293, f294: 294, f295: 295, f296: 296, f297: 297, f298: 298, f299: 299 };
console.log(sum0(wide));

// FILE: shapes.ts
export interface Wide {
  f0: number;
  f1: number;
  f2: number;
  f3: number;
  f4: number;
  f5: number;
  f6: number;
  f7: number;
  f8: number;
  f9: number;
  f10: number;
  f11: number;
  f12: number;
  f13: number;
  f14: number;
  f15: number;
  f16: number;
  f17: number;
  f18: number;
  f19: number;
  f20: number;
  f21: number;
  f22: number;
  f23: number;
  f24: number;
  f25: number;
  f26: number;
  f27: number;
  f28: number;
  f29: number;
  f30: number;
  f31: number;
  f32: number;
  f33: number;
  f34: number;
  f35: number;
  f36: number;
  f37: number;
  f38: number;
  f39: number;
  f40: number;
  f41: number;
  f42: number;
  f43: number;
  f44: number;
  f45: number;
  f46: number;
  f47: number;
  f48: number;
  f49: number;
  f50: number;
  f51: number;
  f52: number;
  f53: number;
  f54: number;
  f55: number;
  f56: number;
  f57: number;
  f58: number;
  f59: number;
  f60: number;
  f61: number;
  f62: number;
  f63: number;
  f64: number;
  f65: number;
  f66: number;
  f67: number;
  f68: number;
  f69: number;
  f70: number;
  f71: number;
  f72: number;
  f73: number;
  f74: number;
  f75: number;
  f76: number;
  f77: number;
  f78: number;
  f79: number;
  f80: number;
  f81: number;
  f82: number;
  f83: number;
  f84: number;
  f85: number;
  f86: number;
  f87: number;
  f88: number;
  f89: number;
  f90: number;
  f91: number;
  f92: number;
  f93: number;
  f94: number;
  f95: number;
  f96: number;
  f97: number;
  f98: number;
  f99: number;
  f100: number;
  f101: number;
  f102: number;
  f103: number;
  f104: number;
  f105: number;
  f106: number;
  f107: number;
  f108: number;
  f109: number;
  f110: number;
  f111: number;
  f112: number;
  f113: number;
  f114: number;
  f115: number;
  f116: number;
  f117: number;
  f118: number;
  f119: number;
  f120: number;
  f121: number;
  f122: number;
  f123: number;
  f124: number;
  f125: number;
  f126: number;
  f127: number;
  f128: number;
  f129: number;
  f130: number;
  f131: number;
  f132: number;
  f133: number;
  f134: number;
  f135: number;
  f136: number;
  f137: number;
  f138: number;
  f139: number;
  f140: number;
  f141: number;
  f142: number;
  f143: number;
  f144: number;
  f145: number;
  f146: number;
  f147: number;
  f148: number;
  f149: number;
  f150: number;
  f151: number;
  f152: number;
  f153: number;
  f154: number;
  f155: number;
  f156: number;
  f157: number;
  f158: number;
  f159: number;
  f160: number;
  f161: number;
  f162: number;
  f163: number;
  f164: number;
  f165: number;
  f166: number;
  f167: number;
  f168: number;
  f169: number;
  f170: number;
  f171: number;
  f172: number;
  f173: number;
  f174: number;
  f175: number;
  f176: number;
  f177: number;
  f178: number;
  f179: number;
  f180: number;
  f181: number;
  f182: number;
  f183: number;
  f184: number;
  f185: number;
  f186: number;
  f187: number;
  f188: number;
  f189: number;
  f190: number;
  f191: number;
  f192: number;
  f193: number;
  f194: number;
  f195: number;
  f196: number;
  f197: number;
  f198: number;
  f199: number;
  f200: number;
  f201: number;
  f202: number;
  f203: number;
  f204: number;
  f205: number;
  f206: number;
  f207: number;
  f208: number;
  f209: number;
  f210: number;
  f211: number;
  f212: number;
  f213: number;
  f214: number;
  f215: number;
  f216: number;
  f217: number;
  f218: number;
  f219: number;
  f220: number;
  f221: number;
  f222: number;
  f223: number;
  f224: number;
  f225: number;
  f226: number;
  f227: number;
  f228: number;
  f229: number;
  f230: number;
  f231: number;
  f232: number;
  f233: number;
  f234: number;
  f235: number;
  f236: number;
  f237: number;
  f238: number;
  f239: number;
  f240: number;
  f241: number;
  f242: number;
  f243: number;
  f244: number;
  f245: number;
  f246: number;
  f247: number;
  f248: number;
  f249: number;
  f250: number;
  f251: number;
  f252: number;
  f253: number;
  f254: number;
  f255: number;
  f256: number;
  f257: number;
  f258: number;
  f259: number;
  f260: number;
  f261: number;
  f262: number;
  f263: number;
  f264: number;
  f265: number;
  f266: number;
  f267: number;
  f268: number;
  f269: number;
  f270: number;
  f271: number;
  f272: number;
  f273: number;
  f274: number;
  f275: number;
  f276: number;
  f277: number;
  f278: number;
  f279: number;
  f280: number;
  f281: number;
  f282: number;
  f283: number;
  f284: number;
  f285: number;
  f286: number;
  f287: number;
  f288: number;
  f289: number;
  f290: number;
  f291: number;
  f292: number;
  f293: number;
  f294: number;
  f295: number;
  f296: number;
  f297: number;
  f298: number;
  f299: number;
}

// FILE: a0.ts
import type { Wide } from "./shapes";
import { sum1 } from "./a1";
export function sum0(wide: Wide): number {
  return wide.f0 + sum1(wide);
}

// FILE: a1.ts
import type { Wide } from "./shapes";
import { sum2 } from "./a2";
export function sum1(wide: Wide): number {
  return wide.f1 + sum2(wide);
}

// FILE: a2.ts
import type { Wide } from "./shapes";
import { sum3 } from "./a3";
export function sum2(wide: Wide): number {
  return wide.f2 + sum3(wide);
}

// FILE: a3.ts
import type { Wide } from "./shapes";
import { sum4 } from "./a4";
export function sum3(wide: Wide): number {
  return wide.f3 + sum4(wide);
}

// FILE: a4.ts
import type { Wide } from "./shapes";
import { sum5 } from "./a5";
export function sum4(wide: Wide): number {
  return wide.f4 + sum5(wide);
}

// FILE: a5.ts
import type { Wide } from "./shapes";
import { sum6 } from "./a6";
export function sum5(wide: Wide): number {
  return wide.f5 + sum6(wide);
}

// FILE: a6.ts
import type { Wide } from "./shapes";
import { sum7 } from "./a7";
export function sum6(wide: Wide): number {
  return wide.f6 + sum7(wide);
}

// FILE: a7.ts
import type { Wide } from "./shapes";
import { sum8 } from "./a8";
export function sum7(wide: Wide): number {
  return wide.f7 + sum8(wide);
}

// FILE: a8.ts
import type { Wide } from "./shapes";
import { sum9 } from "./a9";
export function sum8(wide: Wide): number {
  return wide.f8 + sum9(wide);
}

// FILE: a9.ts
import type { Wide } from "./shapes";
import { sum10 } from "./a10";
export function sum9(wide: Wide): number {
  return wide.f9 + sum10(wide);
}

// FILE: a10.ts
import type { Wide } from "./shapes";
import { sum11 } from "./a11";
export function sum10(wide: Wide): number {
  return wide.f10 + sum11(wide);
}

// FILE: a11.ts
import type { Wide } from "./shapes";
export function sum11(wide: Wide): number {
  return wide.f11;
}

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","strict":true,"noEmit":true,"skipLibCheck":true,"types":[]}}
