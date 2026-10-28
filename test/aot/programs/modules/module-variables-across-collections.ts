// Module variables, exported bindings, static fields and free names keep young objects, strings and closures alive across Eden and full collections.
import * as self from "./module-variables-across-collections";

declare global {
  var sharedName: any;
}

type Box = { index: number; label: string };
type StoredValue = Box | string | (() => number);

const shell: any = globalThis;
const collect = globalThis.Bun ? (full: boolean) => void globalThis.Bun.gc(full) : (full: boolean) => void (full ? shell.fullGC() : shell.edenGC());
const runScript: (text: string) => unknown = globalThis.Bun ? require("node:vm").runInThisContext : shell.loadString;
const bindings: any = self;
const variableCount = 300;
const scatteredIndexes = [3, 40, 77, 150, 222, 299];
const storedRounds: number[] = new Array(variableCount).fill(-1);
const recent: StoredValue[] = new Array(64).fill("");

function createBox(round: number, index: number): Box {
  return { index, label: "box " + round + ":" + index };
}

function createText(round: number, index: number): string {
  return "text " + round + ":" + index;
}

function createClosure(round: number, index: number): () => number {
  return () => round * 1000 + index;
}

function createStoredValue(round: number, index: number): StoredValue {
  if (index % 3 === 0) return createBox(round, index);
  if (index % 3 === 1) return createText(round, index);
  return createClosure(round, index);
}

export function textOf(value: StoredValue | undefined): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "function") return "closure " + value();
  return value.label + " at " + value.index;
}

function expectedText(round: number, index: number): string {
  if (round < 0) return "undefined";
  if (index % 3 === 0) return "box " + round + ":" + index + " at " + index;
  if (index % 3 === 1) return "text " + round + ":" + index;
  return "closure " + (round * 1000 + index);
}

function attempt(read: () => unknown): string {
  try {
    return String(read());
  } catch (error) {
    return (error as Error).name;
  }
}

function churn() {
  for (let index = 0; index < 20000; index++) {
    recent[index & 63] = createStoredValue(-2, index);
    onlyNumbers += textOf(recent[(index * 7) & 63]).length + 0.5;
  }
}

function storeAll(round: number) {
  variable000 = createStoredValue(round, 0); variable001 = createStoredValue(round, 1); variable002 = createStoredValue(round, 2); variable003 = createStoredValue(round, 3); variable004 = createStoredValue(round, 4); variable005 = createStoredValue(round, 5);
  variable006 = createStoredValue(round, 6); variable007 = createStoredValue(round, 7); variable008 = createStoredValue(round, 8); variable009 = createStoredValue(round, 9); variable010 = createStoredValue(round, 10); variable011 = createStoredValue(round, 11);
  variable012 = createStoredValue(round, 12); variable013 = createStoredValue(round, 13); variable014 = createStoredValue(round, 14); variable015 = createStoredValue(round, 15); variable016 = createStoredValue(round, 16); variable017 = createStoredValue(round, 17);
  variable018 = createStoredValue(round, 18); variable019 = createStoredValue(round, 19); variable020 = createStoredValue(round, 20); variable021 = createStoredValue(round, 21); variable022 = createStoredValue(round, 22); variable023 = createStoredValue(round, 23);
  variable024 = createStoredValue(round, 24); variable025 = createStoredValue(round, 25); variable026 = createStoredValue(round, 26); variable027 = createStoredValue(round, 27); variable028 = createStoredValue(round, 28); variable029 = createStoredValue(round, 29);
  variable030 = createStoredValue(round, 30); variable031 = createStoredValue(round, 31); variable032 = createStoredValue(round, 32); variable033 = createStoredValue(round, 33); variable034 = createStoredValue(round, 34); variable035 = createStoredValue(round, 35);
  variable036 = createStoredValue(round, 36); variable037 = createStoredValue(round, 37); variable038 = createStoredValue(round, 38); variable039 = createStoredValue(round, 39); variable040 = createStoredValue(round, 40); variable041 = createStoredValue(round, 41);
  variable042 = createStoredValue(round, 42); variable043 = createStoredValue(round, 43); variable044 = createStoredValue(round, 44); variable045 = createStoredValue(round, 45); variable046 = createStoredValue(round, 46); variable047 = createStoredValue(round, 47);
  variable048 = createStoredValue(round, 48); variable049 = createStoredValue(round, 49); variable050 = createStoredValue(round, 50); variable051 = createStoredValue(round, 51); variable052 = createStoredValue(round, 52); variable053 = createStoredValue(round, 53);
  variable054 = createStoredValue(round, 54); variable055 = createStoredValue(round, 55); variable056 = createStoredValue(round, 56); variable057 = createStoredValue(round, 57); variable058 = createStoredValue(round, 58); variable059 = createStoredValue(round, 59);
  variable060 = createStoredValue(round, 60); variable061 = createStoredValue(round, 61); variable062 = createStoredValue(round, 62); variable063 = createStoredValue(round, 63); variable064 = createStoredValue(round, 64); variable065 = createStoredValue(round, 65);
  variable066 = createStoredValue(round, 66); variable067 = createStoredValue(round, 67); variable068 = createStoredValue(round, 68); variable069 = createStoredValue(round, 69); variable070 = createStoredValue(round, 70); variable071 = createStoredValue(round, 71);
  variable072 = createStoredValue(round, 72); variable073 = createStoredValue(round, 73); variable074 = createStoredValue(round, 74); variable075 = createStoredValue(round, 75); variable076 = createStoredValue(round, 76); variable077 = createStoredValue(round, 77);
  variable078 = createStoredValue(round, 78); variable079 = createStoredValue(round, 79); variable080 = createStoredValue(round, 80); variable081 = createStoredValue(round, 81); variable082 = createStoredValue(round, 82); variable083 = createStoredValue(round, 83);
  variable084 = createStoredValue(round, 84); variable085 = createStoredValue(round, 85); variable086 = createStoredValue(round, 86); variable087 = createStoredValue(round, 87); variable088 = createStoredValue(round, 88); variable089 = createStoredValue(round, 89);
  variable090 = createStoredValue(round, 90); variable091 = createStoredValue(round, 91); variable092 = createStoredValue(round, 92); variable093 = createStoredValue(round, 93); variable094 = createStoredValue(round, 94); variable095 = createStoredValue(round, 95);
  variable096 = createStoredValue(round, 96); variable097 = createStoredValue(round, 97); variable098 = createStoredValue(round, 98); variable099 = createStoredValue(round, 99); variable100 = createStoredValue(round, 100); variable101 = createStoredValue(round, 101);
  variable102 = createStoredValue(round, 102); variable103 = createStoredValue(round, 103); variable104 = createStoredValue(round, 104); variable105 = createStoredValue(round, 105); variable106 = createStoredValue(round, 106); variable107 = createStoredValue(round, 107);
  variable108 = createStoredValue(round, 108); variable109 = createStoredValue(round, 109); variable110 = createStoredValue(round, 110); variable111 = createStoredValue(round, 111); variable112 = createStoredValue(round, 112); variable113 = createStoredValue(round, 113);
  variable114 = createStoredValue(round, 114); variable115 = createStoredValue(round, 115); variable116 = createStoredValue(round, 116); variable117 = createStoredValue(round, 117); variable118 = createStoredValue(round, 118); variable119 = createStoredValue(round, 119);
  variable120 = createStoredValue(round, 120); variable121 = createStoredValue(round, 121); variable122 = createStoredValue(round, 122); variable123 = createStoredValue(round, 123); variable124 = createStoredValue(round, 124); variable125 = createStoredValue(round, 125);
  variable126 = createStoredValue(round, 126); variable127 = createStoredValue(round, 127); variable128 = createStoredValue(round, 128); variable129 = createStoredValue(round, 129); variable130 = createStoredValue(round, 130); variable131 = createStoredValue(round, 131);
  variable132 = createStoredValue(round, 132); variable133 = createStoredValue(round, 133); variable134 = createStoredValue(round, 134); variable135 = createStoredValue(round, 135); variable136 = createStoredValue(round, 136); variable137 = createStoredValue(round, 137);
  variable138 = createStoredValue(round, 138); variable139 = createStoredValue(round, 139); variable140 = createStoredValue(round, 140); variable141 = createStoredValue(round, 141); variable142 = createStoredValue(round, 142); variable143 = createStoredValue(round, 143);
  variable144 = createStoredValue(round, 144); variable145 = createStoredValue(round, 145); variable146 = createStoredValue(round, 146); variable147 = createStoredValue(round, 147); variable148 = createStoredValue(round, 148); variable149 = createStoredValue(round, 149);
  variable150 = createStoredValue(round, 150); variable151 = createStoredValue(round, 151); variable152 = createStoredValue(round, 152); variable153 = createStoredValue(round, 153); variable154 = createStoredValue(round, 154); variable155 = createStoredValue(round, 155);
  variable156 = createStoredValue(round, 156); variable157 = createStoredValue(round, 157); variable158 = createStoredValue(round, 158); variable159 = createStoredValue(round, 159); variable160 = createStoredValue(round, 160); variable161 = createStoredValue(round, 161);
  variable162 = createStoredValue(round, 162); variable163 = createStoredValue(round, 163); variable164 = createStoredValue(round, 164); variable165 = createStoredValue(round, 165); variable166 = createStoredValue(round, 166); variable167 = createStoredValue(round, 167);
  variable168 = createStoredValue(round, 168); variable169 = createStoredValue(round, 169); variable170 = createStoredValue(round, 170); variable171 = createStoredValue(round, 171); variable172 = createStoredValue(round, 172); variable173 = createStoredValue(round, 173);
  variable174 = createStoredValue(round, 174); variable175 = createStoredValue(round, 175); variable176 = createStoredValue(round, 176); variable177 = createStoredValue(round, 177); variable178 = createStoredValue(round, 178); variable179 = createStoredValue(round, 179);
  variable180 = createStoredValue(round, 180); variable181 = createStoredValue(round, 181); variable182 = createStoredValue(round, 182); variable183 = createStoredValue(round, 183); variable184 = createStoredValue(round, 184); variable185 = createStoredValue(round, 185);
  variable186 = createStoredValue(round, 186); variable187 = createStoredValue(round, 187); variable188 = createStoredValue(round, 188); variable189 = createStoredValue(round, 189); variable190 = createStoredValue(round, 190); variable191 = createStoredValue(round, 191);
  variable192 = createStoredValue(round, 192); variable193 = createStoredValue(round, 193); variable194 = createStoredValue(round, 194); variable195 = createStoredValue(round, 195); variable196 = createStoredValue(round, 196); variable197 = createStoredValue(round, 197);
  variable198 = createStoredValue(round, 198); variable199 = createStoredValue(round, 199); variable200 = createStoredValue(round, 200); variable201 = createStoredValue(round, 201); variable202 = createStoredValue(round, 202); variable203 = createStoredValue(round, 203);
  variable204 = createStoredValue(round, 204); variable205 = createStoredValue(round, 205); variable206 = createStoredValue(round, 206); variable207 = createStoredValue(round, 207); variable208 = createStoredValue(round, 208); variable209 = createStoredValue(round, 209);
  variable210 = createStoredValue(round, 210); variable211 = createStoredValue(round, 211); variable212 = createStoredValue(round, 212); variable213 = createStoredValue(round, 213); variable214 = createStoredValue(round, 214); variable215 = createStoredValue(round, 215);
  variable216 = createStoredValue(round, 216); variable217 = createStoredValue(round, 217); variable218 = createStoredValue(round, 218); variable219 = createStoredValue(round, 219); variable220 = createStoredValue(round, 220); variable221 = createStoredValue(round, 221);
  variable222 = createStoredValue(round, 222); variable223 = createStoredValue(round, 223); variable224 = createStoredValue(round, 224); variable225 = createStoredValue(round, 225); variable226 = createStoredValue(round, 226); variable227 = createStoredValue(round, 227);
  variable228 = createStoredValue(round, 228); variable229 = createStoredValue(round, 229); variable230 = createStoredValue(round, 230); variable231 = createStoredValue(round, 231); variable232 = createStoredValue(round, 232); variable233 = createStoredValue(round, 233);
  variable234 = createStoredValue(round, 234); variable235 = createStoredValue(round, 235); variable236 = createStoredValue(round, 236); variable237 = createStoredValue(round, 237); variable238 = createStoredValue(round, 238); variable239 = createStoredValue(round, 239);
  variable240 = createStoredValue(round, 240); variable241 = createStoredValue(round, 241); variable242 = createStoredValue(round, 242); variable243 = createStoredValue(round, 243); variable244 = createStoredValue(round, 244); variable245 = createStoredValue(round, 245);
  variable246 = createStoredValue(round, 246); variable247 = createStoredValue(round, 247); variable248 = createStoredValue(round, 248); variable249 = createStoredValue(round, 249); variable250 = createStoredValue(round, 250); variable251 = createStoredValue(round, 251);
  variable252 = createStoredValue(round, 252); variable253 = createStoredValue(round, 253); variable254 = createStoredValue(round, 254); variable255 = createStoredValue(round, 255); variable256 = createStoredValue(round, 256); variable257 = createStoredValue(round, 257);
  variable258 = createStoredValue(round, 258); variable259 = createStoredValue(round, 259); variable260 = createStoredValue(round, 260); variable261 = createStoredValue(round, 261); variable262 = createStoredValue(round, 262); variable263 = createStoredValue(round, 263);
  variable264 = createStoredValue(round, 264); variable265 = createStoredValue(round, 265); variable266 = createStoredValue(round, 266); variable267 = createStoredValue(round, 267); variable268 = createStoredValue(round, 268); variable269 = createStoredValue(round, 269);
  variable270 = createStoredValue(round, 270); variable271 = createStoredValue(round, 271); variable272 = createStoredValue(round, 272); variable273 = createStoredValue(round, 273); variable274 = createStoredValue(round, 274); variable275 = createStoredValue(round, 275);
  variable276 = createStoredValue(round, 276); variable277 = createStoredValue(round, 277); variable278 = createStoredValue(round, 278); variable279 = createStoredValue(round, 279); variable280 = createStoredValue(round, 280); variable281 = createStoredValue(round, 281);
  variable282 = createStoredValue(round, 282); variable283 = createStoredValue(round, 283); variable284 = createStoredValue(round, 284); variable285 = createStoredValue(round, 285); variable286 = createStoredValue(round, 286); variable287 = createStoredValue(round, 287);
  variable288 = createStoredValue(round, 288); variable289 = createStoredValue(round, 289); variable290 = createStoredValue(round, 290); variable291 = createStoredValue(round, 291); variable292 = createStoredValue(round, 292); variable293 = createStoredValue(round, 293);
  variable294 = createStoredValue(round, 294); variable295 = createStoredValue(round, 295); variable296 = createStoredValue(round, 296); variable297 = createStoredValue(round, 297); variable298 = createStoredValue(round, 298); variable299 = createStoredValue(round, 299);
  storedRounds.fill(round);
}

function storeScattered(round: number) {
  variable003 = createStoredValue(round, 3);
  variable040 = createStoredValue(round, 40);
  variable077 = createStoredValue(round, 77);
  variable150 = createStoredValue(round, 150);
  variable222 = createStoredValue(round, 222);
  variable299 = createStoredValue(round, 299);
  for (const index of scatteredIndexes) storedRounds[index] = round;
}

function readAll(): StoredValue[] {
  return [
    variable000, variable001, variable002, variable003, variable004, variable005, variable006, variable007, variable008, variable009, variable010, variable011, variable012, variable013, variable014,
    variable015, variable016, variable017, variable018, variable019, variable020, variable021, variable022, variable023, variable024, variable025, variable026, variable027, variable028, variable029,
    variable030, variable031, variable032, variable033, variable034, variable035, variable036, variable037, variable038, variable039, variable040, variable041, variable042, variable043, variable044,
    variable045, variable046, variable047, variable048, variable049, variable050, variable051, variable052, variable053, variable054, variable055, variable056, variable057, variable058, variable059,
    variable060, variable061, variable062, variable063, variable064, variable065, variable066, variable067, variable068, variable069, variable070, variable071, variable072, variable073, variable074,
    variable075, variable076, variable077, variable078, variable079, variable080, variable081, variable082, variable083, variable084, variable085, variable086, variable087, variable088, variable089,
    variable090, variable091, variable092, variable093, variable094, variable095, variable096, variable097, variable098, variable099, variable100, variable101, variable102, variable103, variable104,
    variable105, variable106, variable107, variable108, variable109, variable110, variable111, variable112, variable113, variable114, variable115, variable116, variable117, variable118, variable119,
    variable120, variable121, variable122, variable123, variable124, variable125, variable126, variable127, variable128, variable129, variable130, variable131, variable132, variable133, variable134,
    variable135, variable136, variable137, variable138, variable139, variable140, variable141, variable142, variable143, variable144, variable145, variable146, variable147, variable148, variable149,
    variable150, variable151, variable152, variable153, variable154, variable155, variable156, variable157, variable158, variable159, variable160, variable161, variable162, variable163, variable164,
    variable165, variable166, variable167, variable168, variable169, variable170, variable171, variable172, variable173, variable174, variable175, variable176, variable177, variable178, variable179,
    variable180, variable181, variable182, variable183, variable184, variable185, variable186, variable187, variable188, variable189, variable190, variable191, variable192, variable193, variable194,
    variable195, variable196, variable197, variable198, variable199, variable200, variable201, variable202, variable203, variable204, variable205, variable206, variable207, variable208, variable209,
    variable210, variable211, variable212, variable213, variable214, variable215, variable216, variable217, variable218, variable219, variable220, variable221, variable222, variable223, variable224,
    variable225, variable226, variable227, variable228, variable229, variable230, variable231, variable232, variable233, variable234, variable235, variable236, variable237, variable238, variable239,
    variable240, variable241, variable242, variable243, variable244, variable245, variable246, variable247, variable248, variable249, variable250, variable251, variable252, variable253, variable254,
    variable255, variable256, variable257, variable258, variable259, variable260, variable261, variable262, variable263, variable264, variable265, variable266, variable267, variable268, variable269,
    variable270, variable271, variable272, variable273, variable274, variable275, variable276, variable277, variable278, variable279, variable280, variable281, variable282, variable283, variable284,
    variable285, variable286, variable287, variable288, variable289, variable290, variable291, variable292, variable293, variable294, variable295, variable296, variable297, variable298, variable299,
  ];
}

function storeNamed(round: number) {
  exportedBox = createBox(round, 300);
  exportedText = createText(round, 301);
  exportedClosure = createClosure(round, 302);
  Registry.box = createBox(round, 303);
  Registry.text = createText(round, 304);
  Registry.closure = createClosure(round, 305);
  namedRound = round;
}

function check(what: string) {
  const values = readAll();
  let mismatches = 0;
  for (let index = 0; index < variableCount; index++) {
    if (textOf(values[index]) !== expectedText(storedRounds[index], index)) mismatches++;
  }
  const named = [self.exportedBox, self.exportedText, self.exportedClosure, Registry.box, Registry.text, Registry.closure];
  for (let index = 0; index < named.length; index++) {
    if (textOf(named[index]) !== expectedText(namedRound, 300 + index)) mismatches++;
  }
  for (let index = 0; index < exportedNames.length; index++) {
    if (textOf(bindings[exportedNames[index]]) !== expectedText(namedRound, 300 + index)) mismatches++;
  }
  console.log(what + ": " + mismatches + " mismatches, neverStored is " + textOf(neverStored) + ", declaredLast: " + attempt(() => self.declaredLast.label));
}

function sumSharedName(times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum += typeof sharedName === "number" ? sharedName : sharedName.index;
  return sum;
}

const exportedNames = ["exportedBox", "exportedText", "exportedClosure"];
for (const name of [...exportedNames, "declaredLast", "textOf"]) console.log(name + " before the declarations: " + attempt(() => typeof bindings[name]));
console.log("exportedText read by name: " + attempt(() => self.exportedText));

let variable000: StoredValue, variable001: StoredValue, variable002: StoredValue, variable003: StoredValue, variable004: StoredValue, variable005: StoredValue, variable006: StoredValue, variable007: StoredValue, variable008: StoredValue, variable009: StoredValue;
let variable010: StoredValue, variable011: StoredValue, variable012: StoredValue, variable013: StoredValue, variable014: StoredValue, variable015: StoredValue, variable016: StoredValue, variable017: StoredValue, variable018: StoredValue, variable019: StoredValue;
let variable020: StoredValue, variable021: StoredValue, variable022: StoredValue, variable023: StoredValue, variable024: StoredValue, variable025: StoredValue, variable026: StoredValue, variable027: StoredValue, variable028: StoredValue, variable029: StoredValue;
let variable030: StoredValue, variable031: StoredValue, variable032: StoredValue, variable033: StoredValue, variable034: StoredValue, variable035: StoredValue, variable036: StoredValue, variable037: StoredValue, variable038: StoredValue, variable039: StoredValue;
let variable040: StoredValue, variable041: StoredValue, variable042: StoredValue, variable043: StoredValue, variable044: StoredValue, variable045: StoredValue, variable046: StoredValue, variable047: StoredValue, variable048: StoredValue, variable049: StoredValue;
let variable050: StoredValue, variable051: StoredValue, variable052: StoredValue, variable053: StoredValue, variable054: StoredValue, variable055: StoredValue, variable056: StoredValue, variable057: StoredValue, variable058: StoredValue, variable059: StoredValue;
let variable060: StoredValue, variable061: StoredValue, variable062: StoredValue, variable063: StoredValue, variable064: StoredValue, variable065: StoredValue, variable066: StoredValue, variable067: StoredValue, variable068: StoredValue, variable069: StoredValue;
let variable070: StoredValue, variable071: StoredValue, variable072: StoredValue, variable073: StoredValue, variable074: StoredValue, variable075: StoredValue, variable076: StoredValue, variable077: StoredValue, variable078: StoredValue, variable079: StoredValue;
let variable080: StoredValue, variable081: StoredValue, variable082: StoredValue, variable083: StoredValue, variable084: StoredValue, variable085: StoredValue, variable086: StoredValue, variable087: StoredValue, variable088: StoredValue, variable089: StoredValue;
let variable090: StoredValue, variable091: StoredValue, variable092: StoredValue, variable093: StoredValue, variable094: StoredValue, variable095: StoredValue, variable096: StoredValue, variable097: StoredValue, variable098: StoredValue, variable099: StoredValue;
let variable100: StoredValue, variable101: StoredValue, variable102: StoredValue, variable103: StoredValue, variable104: StoredValue, variable105: StoredValue, variable106: StoredValue, variable107: StoredValue, variable108: StoredValue, variable109: StoredValue;
let variable110: StoredValue, variable111: StoredValue, variable112: StoredValue, variable113: StoredValue, variable114: StoredValue, variable115: StoredValue, variable116: StoredValue, variable117: StoredValue, variable118: StoredValue, variable119: StoredValue;
let variable120: StoredValue, variable121: StoredValue, variable122: StoredValue, variable123: StoredValue, variable124: StoredValue, variable125: StoredValue, variable126: StoredValue, variable127: StoredValue, variable128: StoredValue, variable129: StoredValue;
let variable130: StoredValue, variable131: StoredValue, variable132: StoredValue, variable133: StoredValue, variable134: StoredValue, variable135: StoredValue, variable136: StoredValue, variable137: StoredValue, variable138: StoredValue, variable139: StoredValue;
let variable140: StoredValue, variable141: StoredValue, variable142: StoredValue, variable143: StoredValue, variable144: StoredValue, variable145: StoredValue, variable146: StoredValue, variable147: StoredValue, variable148: StoredValue, variable149: StoredValue;
let variable150: StoredValue, variable151: StoredValue, variable152: StoredValue, variable153: StoredValue, variable154: StoredValue, variable155: StoredValue, variable156: StoredValue, variable157: StoredValue, variable158: StoredValue, variable159: StoredValue;
let variable160: StoredValue, variable161: StoredValue, variable162: StoredValue, variable163: StoredValue, variable164: StoredValue, variable165: StoredValue, variable166: StoredValue, variable167: StoredValue, variable168: StoredValue, variable169: StoredValue;
let variable170: StoredValue, variable171: StoredValue, variable172: StoredValue, variable173: StoredValue, variable174: StoredValue, variable175: StoredValue, variable176: StoredValue, variable177: StoredValue, variable178: StoredValue, variable179: StoredValue;
let variable180: StoredValue, variable181: StoredValue, variable182: StoredValue, variable183: StoredValue, variable184: StoredValue, variable185: StoredValue, variable186: StoredValue, variable187: StoredValue, variable188: StoredValue, variable189: StoredValue;
let variable190: StoredValue, variable191: StoredValue, variable192: StoredValue, variable193: StoredValue, variable194: StoredValue, variable195: StoredValue, variable196: StoredValue, variable197: StoredValue, variable198: StoredValue, variable199: StoredValue;
let variable200: StoredValue, variable201: StoredValue, variable202: StoredValue, variable203: StoredValue, variable204: StoredValue, variable205: StoredValue, variable206: StoredValue, variable207: StoredValue, variable208: StoredValue, variable209: StoredValue;
let variable210: StoredValue, variable211: StoredValue, variable212: StoredValue, variable213: StoredValue, variable214: StoredValue, variable215: StoredValue, variable216: StoredValue, variable217: StoredValue, variable218: StoredValue, variable219: StoredValue;
let variable220: StoredValue, variable221: StoredValue, variable222: StoredValue, variable223: StoredValue, variable224: StoredValue, variable225: StoredValue, variable226: StoredValue, variable227: StoredValue, variable228: StoredValue, variable229: StoredValue;
let variable230: StoredValue, variable231: StoredValue, variable232: StoredValue, variable233: StoredValue, variable234: StoredValue, variable235: StoredValue, variable236: StoredValue, variable237: StoredValue, variable238: StoredValue, variable239: StoredValue;
let variable240: StoredValue, variable241: StoredValue, variable242: StoredValue, variable243: StoredValue, variable244: StoredValue, variable245: StoredValue, variable246: StoredValue, variable247: StoredValue, variable248: StoredValue, variable249: StoredValue;
let variable250: StoredValue, variable251: StoredValue, variable252: StoredValue, variable253: StoredValue, variable254: StoredValue, variable255: StoredValue, variable256: StoredValue, variable257: StoredValue, variable258: StoredValue, variable259: StoredValue;
let variable260: StoredValue, variable261: StoredValue, variable262: StoredValue, variable263: StoredValue, variable264: StoredValue, variable265: StoredValue, variable266: StoredValue, variable267: StoredValue, variable268: StoredValue, variable269: StoredValue;
let variable270: StoredValue, variable271: StoredValue, variable272: StoredValue, variable273: StoredValue, variable274: StoredValue, variable275: StoredValue, variable276: StoredValue, variable277: StoredValue, variable278: StoredValue, variable279: StoredValue;
let variable280: StoredValue, variable281: StoredValue, variable282: StoredValue, variable283: StoredValue, variable284: StoredValue, variable285: StoredValue, variable286: StoredValue, variable287: StoredValue, variable288: StoredValue, variable289: StoredValue;
let variable290: StoredValue, variable291: StoredValue, variable292: StoredValue, variable293: StoredValue, variable294: StoredValue, variable295: StoredValue, variable296: StoredValue, variable297: StoredValue, variable298: StoredValue, variable299: StoredValue;
let neverStored: StoredValue | undefined;
let onlyNumbers = 0.25;
let namedRound = -1;
export let exportedBox: Box;
export let exportedText: string;
export let exportedClosure: () => number;

class Registry {
  static box: Box;
  static text: string;
  static closure: () => number;
}

collect(false);
churn();
check("nothing stored");
for (let round = 0; round < 4; round++) {
  storeAll(round);
  storeNamed(round);
  collect(false);
  churn();
  check("round " + round + ", all stored, Eden collection");
  storeScattered(round + 100);
  collect(false);
  churn();
  check("round " + round + ", some stored, Eden collection");
  collect(true);
  churn();
  check("round " + round + ", full collection");
}
console.log("onlyNumbers: " + onlyNumbers);

globalThis.sharedName = 7;
console.log("a number: " + sumSharedName(1000));
globalThis.sharedName = createBox(0, 9);
collect(false);
churn();
console.log("a young object: " + sumSharedName(1000) + ", " + sharedName.label);
collect(true);
churn();
console.log("after a full collection: " + sumSharedName(1000) + ", " + sharedName.label);
runScript("let sharedName = { index: 11, label: 'lexical ' + [1, 2].length };");
collect(false);
churn();
console.log("shadowed: " + sumSharedName(1000) + ", " + sharedName.label + ", the property: " + globalThis.sharedName.label);
runScript("sharedName = { index: 13, label: 'stored by a script ' + [1, 2, 3].length };");
collect(true);
churn();
console.log("stored by a script: " + sumSharedName(1000) + ", " + sharedName.label);
sharedName = createBox(1, 15);
collect(false);
churn();
console.log("stored by the module: " + sumSharedName(1000) + ", " + runScript("sharedName.label") + ", the property: " + globalThis.sharedName.label);

export let declaredLast: Box = createBox(5, 306);
collect(true);
churn();
check("everything declared");
