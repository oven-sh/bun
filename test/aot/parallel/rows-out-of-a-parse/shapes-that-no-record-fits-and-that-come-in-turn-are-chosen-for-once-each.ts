// Four records end in `id`. The rows below come in 256 shapes that end in `id` too, and no record can be filled from any of them. The parser keeps what it found for a shape in a table of 128 places,
// so 256 shapes that come in turn push one another out of it. All the shapes live, and that nothing fits a shape is remembered for as long as it lives: the choice is made once a shape, not once a row.
// COUNTER: RecordPlanChoices <= 280
// COUNTER: RecordPlanCandidates <= 8
// COUNTER: ObjectsParsedIntoOrdinaryObjects >= 5000
// COUNTER: ObjectsParsedIntoRecords >= 4
interface Kind0 { a: number; id: number; own0: number }
interface Kind1 { a: number; id: number; own1: number }
interface Kind2 { a: number; id: number; own2: number }
interface Kind3 { a: number; id: number; own3: number }
let sum = 0;
const kind0: Kind0[] = JSON.parse('[{"a":1,"own0":0,"id":2}]'); sum += kind0[0]!.own0;
const kind1: Kind1[] = JSON.parse('[{"a":1,"own1":1,"id":2}]'); sum += kind1[0]!.own1;
const kind2: Kind2[] = JSON.parse('[{"a":1,"own2":2,"id":2}]'); sum += kind2[0]!.own2;
const kind3: Kind3[] = JSON.parse('[{"a":1,"own3":3,"id":2}]'); sum += kind3[0]!.own3;
const spelled = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9, k10: 10, k11: 11, k12: 12, k13: 13, k14: 14, k15: 15, k16: 16, k17: 17, k18: 18, k19: 19, k20: 20, k21: 21, k22: 22, k23: 23, k24: 24, k25: 25, k26: 26, k27: 27, k28: 28, k29: 29, k30: 30, k31: 31, k32: 32, k33: 33, k34: 34, k35: 35, k36: 36, k37: 37, k38: 38, k39: 39, k40: 40, k41: 41, k42: 42, k43: 43, k44: 44, k45: 45, k46: 46, k47: 47, k48: 48, k49: 49, k50: 50, k51: 51, k52: 52, k53: 53, k54: 54, k55: 55, k56: 56, k57: 57, k58: 58, k59: 59, k60: 60, k61: 61, k62: 62, k63: 63, k64: 64, k65: 65, k66: 66, k67: 67, k68: 68, k69: 69, k70: 70, k71: 71, k72: 72, k73: 73, k74: 74, k75: 75, k76: 76, k77: 77, k78: 78, k79: 79, k80: 80, k81: 81, k82: 82, k83: 83, k84: 84, k85: 85, k86: 86, k87: 87, k88: 88, k89: 89, k90: 90, k91: 91, k92: 92, k93: 93, k94: 94, k95: 95, k96: 96, k97: 97, k98: 98, k99: 99, k100: 100, k101: 101, k102: 102, k103: 103, k104: 104, k105: 105, k106: 106, k107: 107, k108: 108, k109: 109, k110: 110, k111: 111, k112: 112, k113: 113, k114: 114, k115: 115, k116: 116, k117: 117, k118: 118, k119: 119, k120: 120, k121: 121, k122: 122, k123: 123, k124: 124, k125: 125, k126: 126, k127: 127, k128: 128, k129: 129, k130: 130, k131: 131, k132: 132, k133: 133, k134: 134, k135: 135, k136: 136, k137: 137, k138: 138, k139: 139, k140: 140, k141: 141, k142: 142, k143: 143, k144: 144, k145: 145, k146: 146, k147: 147, k148: 148, k149: 149, k150: 150, k151: 151, k152: 152, k153: 153, k154: 154, k155: 155, k156: 156, k157: 157, k158: 158, k159: 159, k160: 160, k161: 161, k162: 162, k163: 163, k164: 164, k165: 165, k166: 166, k167: 167, k168: 168, k169: 169, k170: 170, k171: 171, k172: 172, k173: 173, k174: 174, k175: 175, k176: 176, k177: 177, k178: 178, k179: 179, k180: 180, k181: 181, k182: 182, k183: 183, k184: 184, k185: 185, k186: 186, k187: 187, k188: 188, k189: 189, k190: 190, k191: 191, k192: 192, k193: 193, k194: 194, k195: 195, k196: 196, k197: 197, k198: 198, k199: 199, k200: 200, k201: 201, k202: 202, k203: 203, k204: 204, k205: 205, k206: 206, k207: 207, k208: 208, k209: 209, k210: 210, k211: 211, k212: 212, k213: 213, k214: 214, k215: 215, k216: 216, k217: 217, k218: 218, k219: 219, k220: 220, k221: 221, k222: 222, k223: 223, k224: 224, k225: 225, k226: 226, k227: 227, k228: 228, k229: 229, k230: 230, k231: 231, k232: 232, k233: 233, k234: 234, k235: 235, k236: 236, k237: 237, k238: 238, k239: 239, k240: 240, k241: 241, k242: 242, k243: 243, k244: 244, k245: 245, k246: 246, k247: 247, k248: 248, k249: 249, k250: 250, k251: 251, k252: 252, k253: 253, k254: 254, k255: 255 };
let text = "[";
for (let i = 0; i < 256; i++) text += (i ? "," : "") + '{"k' + i + '":' + i + ',"id":7}';
text += "]";
const kept: any[] = JSON.parse(text);
for (let turn = 0; turn < 20; turn++) {
  const rows: any[] = JSON.parse(text);
  sum += rows[turn * 13 % 256].id + rows[turn]["k" + turn];
}
console.log(sum, kept.length, Object.keys(spelled).length);
