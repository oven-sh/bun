class K0 {
  base = 0;
  tag(): number {
    return 0;
  }
}
class K1 extends K0 { tag(): number { return 1; } }
class K2 extends K0 { tag(): number { return 2; } }
class K3 extends K1 { tag(): number { return 3; } mark(): number { return 21; } }
class K4 extends K1 { tag(): number { return 4; } }
class K5 extends K2 { tag(): number { return 5; } }
class K6 extends K2 { tag(): number { return 6; } mark(): number { return 42; } }
class K7 extends K3 { tag(): number { return 7; } }
class K8 extends K3 { tag(): number { return 8; } }
class K9 extends K4 { tag(): number { return 9; } mark(): number { return 63; } }
class K10 extends K4 { tag(): number { return 10; } }
class K11 extends K5 { tag(): number { return 11; } }
class K12 extends K5 { tag(): number { return 12; } mark(): number { return 84; } }
class K13 extends K6 { tag(): number { return 13; } }
class K14 extends K6 { tag(): number { return 14; } }
class K15 extends K7 { tag(): number { return 15; } mark(): number { return 105; } }
class K16 extends K7 { tag(): number { return 16; } }
class K17 extends K8 { tag(): number { return 17; } }
class K18 extends K8 { tag(): number { return 18; } mark(): number { return 126; } }
class K19 extends K9 { tag(): number { return 19; } }
class K20 extends K9 { tag(): number { return 20; } }
class K21 extends K10 { tag(): number { return 21; } mark(): number { return 147; } }
class K22 extends K10 { tag(): number { return 22; } }
class K23 extends K11 { tag(): number { return 23; } }
class K24 extends K11 { tag(): number { return 24; } mark(): number { return 168; } }
class K25 extends K12 { tag(): number { return 25; } }
class K26 extends K12 { tag(): number { return 26; } }
class K27 extends K13 { tag(): number { return 27; } mark(): number { return 189; } }
class K28 extends K13 { tag(): number { return 28; } }
class K29 extends K14 { tag(): number { return 29; } }
class K30 extends K14 { tag(): number { return 30; } mark(): number { return 210; } }
class K31 extends K15 { tag(): number { return 31; } }
class K32 extends K15 { tag(): number { return 32; } }
class K33 extends K16 { tag(): number { return 33; } mark(): number { return 231; } }
class K34 extends K16 { tag(): number { return 34; } }
class K35 extends K17 { tag(): number { return 35; } }
class K36 extends K17 { tag(): number { return 36; } mark(): number { return 252; } }
class K37 extends K18 { tag(): number { return 37; } }
class K38 extends K18 { tag(): number { return 38; } }
class K39 extends K19 { tag(): number { return 39; } mark(): number { return 273; } }
class K40 extends K19 { tag(): number { return 40; } }
class K41 extends K20 { tag(): number { return 41; } }
class K42 extends K20 { tag(): number { return 42; } mark(): number { return 294; } }
class K43 extends K21 { tag(): number { return 43; } }
class K44 extends K21 { tag(): number { return 44; } }
class K45 extends K22 { tag(): number { return 45; } mark(): number { return 315; } }
class K46 extends K22 { tag(): number { return 46; } }
class K47 extends K23 { tag(): number { return 47; } }
class K48 extends K23 { tag(): number { return 48; } mark(): number { return 336; } }
class K49 extends K24 { tag(): number { return 49; } }
class K50 extends K24 { tag(): number { return 50; } }
class K51 extends K25 { tag(): number { return 51; } mark(): number { return 357; } }
class K52 extends K25 { tag(): number { return 52; } }
class K53 extends K26 { tag(): number { return 53; } }
class K54 extends K26 { tag(): number { return 54; } mark(): number { return 378; } }
class K55 extends K27 { tag(): number { return 55; } }
class K56 extends K27 { tag(): number { return 56; } }
class K57 extends K28 { tag(): number { return 57; } mark(): number { return 399; } }
class K58 extends K28 { tag(): number { return 58; } }
class K59 extends K29 { tag(): number { return 59; } }
class K60 extends K29 { tag(): number { return 60; } mark(): number { return 420; } }
class K61 extends K30 { tag(): number { return 61; } }
class K62 extends K30 { tag(): number { return 62; } }
class K63 extends K31 { tag(): number { return 63; } mark(): number { return 441; } }
class K64 extends K31 { tag(): number { return 64; } }
class K65 extends K32 { tag(): number { return 65; } }
class K66 extends K32 { tag(): number { return 66; } mark(): number { return 462; } }
class K67 extends K33 { tag(): number { return 67; } }
class K68 extends K33 { tag(): number { return 68; } }
class K69 extends K34 { tag(): number { return 69; } mark(): number { return 483; } }

const classes = [K0, K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14, K15, K16, K17, K18, K19, K20, K21, K22, K23, K24, K25, K26, K27, K28, K29, K30, K31, K32, K33, K34, K35, K36, K37, K38, K39, K40, K41, K42, K43, K44, K45, K46, K47, K48, K49, K50, K51, K52, K53, K54, K55, K56, K57, K58, K59, K60, K61, K62, K63, K64, K65, K66, K67, K68, K69];

interface Marked {
  mark(): number;
}

function instanceSumOfUnknown(x: unknown): number {
  let sum = 0;
  if (x instanceof K0) sum = (sum * 31 + 1) | 0;
  if (x instanceof K1) sum = (sum * 31 + 2) | 0;
  if (x instanceof K2) sum = (sum * 31 + 3) | 0;
  if (x instanceof K3) sum = (sum * 31 + 4) | 0;
  if (x instanceof K4) sum = (sum * 31 + 5) | 0;
  if (x instanceof K5) sum = (sum * 31 + 6) | 0;
  if (x instanceof K6) sum = (sum * 31 + 7) | 0;
  if (x instanceof K7) sum = (sum * 31 + 8) | 0;
  if (x instanceof K8) sum = (sum * 31 + 9) | 0;
  if (x instanceof K9) sum = (sum * 31 + 10) | 0;
  if (x instanceof K10) sum = (sum * 31 + 11) | 0;
  if (x instanceof K11) sum = (sum * 31 + 12) | 0;
  if (x instanceof K12) sum = (sum * 31 + 13) | 0;
  if (x instanceof K13) sum = (sum * 31 + 14) | 0;
  if (x instanceof K14) sum = (sum * 31 + 15) | 0;
  if (x instanceof K15) sum = (sum * 31 + 16) | 0;
  if (x instanceof K16) sum = (sum * 31 + 17) | 0;
  if (x instanceof K17) sum = (sum * 31 + 18) | 0;
  if (x instanceof K18) sum = (sum * 31 + 19) | 0;
  if (x instanceof K19) sum = (sum * 31 + 20) | 0;
  if (x instanceof K20) sum = (sum * 31 + 21) | 0;
  if (x instanceof K21) sum = (sum * 31 + 22) | 0;
  if (x instanceof K22) sum = (sum * 31 + 23) | 0;
  if (x instanceof K23) sum = (sum * 31 + 24) | 0;
  if (x instanceof K24) sum = (sum * 31 + 25) | 0;
  if (x instanceof K25) sum = (sum * 31 + 26) | 0;
  if (x instanceof K26) sum = (sum * 31 + 27) | 0;
  if (x instanceof K27) sum = (sum * 31 + 28) | 0;
  if (x instanceof K28) sum = (sum * 31 + 29) | 0;
  if (x instanceof K29) sum = (sum * 31 + 30) | 0;
  if (x instanceof K30) sum = (sum * 31 + 31) | 0;
  if (x instanceof K31) sum = (sum * 31 + 32) | 0;
  if (x instanceof K32) sum = (sum * 31 + 33) | 0;
  if (x instanceof K33) sum = (sum * 31 + 34) | 0;
  if (x instanceof K34) sum = (sum * 31 + 35) | 0;
  if (x instanceof K35) sum = (sum * 31 + 36) | 0;
  if (x instanceof K36) sum = (sum * 31 + 37) | 0;
  if (x instanceof K37) sum = (sum * 31 + 38) | 0;
  if (x instanceof K38) sum = (sum * 31 + 39) | 0;
  if (x instanceof K39) sum = (sum * 31 + 40) | 0;
  if (x instanceof K40) sum = (sum * 31 + 41) | 0;
  if (x instanceof K41) sum = (sum * 31 + 42) | 0;
  if (x instanceof K42) sum = (sum * 31 + 43) | 0;
  if (x instanceof K43) sum = (sum * 31 + 44) | 0;
  if (x instanceof K44) sum = (sum * 31 + 45) | 0;
  if (x instanceof K45) sum = (sum * 31 + 46) | 0;
  if (x instanceof K46) sum = (sum * 31 + 47) | 0;
  if (x instanceof K47) sum = (sum * 31 + 48) | 0;
  if (x instanceof K48) sum = (sum * 31 + 49) | 0;
  if (x instanceof K49) sum = (sum * 31 + 50) | 0;
  if (x instanceof K50) sum = (sum * 31 + 51) | 0;
  if (x instanceof K51) sum = (sum * 31 + 52) | 0;
  if (x instanceof K52) sum = (sum * 31 + 53) | 0;
  if (x instanceof K53) sum = (sum * 31 + 54) | 0;
  if (x instanceof K54) sum = (sum * 31 + 55) | 0;
  if (x instanceof K55) sum = (sum * 31 + 56) | 0;
  if (x instanceof K56) sum = (sum * 31 + 57) | 0;
  if (x instanceof K57) sum = (sum * 31 + 58) | 0;
  if (x instanceof K58) sum = (sum * 31 + 59) | 0;
  if (x instanceof K59) sum = (sum * 31 + 60) | 0;
  if (x instanceof K60) sum = (sum * 31 + 61) | 0;
  if (x instanceof K61) sum = (sum * 31 + 62) | 0;
  if (x instanceof K62) sum = (sum * 31 + 63) | 0;
  if (x instanceof K63) sum = (sum * 31 + 64) | 0;
  if (x instanceof K64) sum = (sum * 31 + 65) | 0;
  if (x instanceof K65) sum = (sum * 31 + 66) | 0;
  if (x instanceof K66) sum = (sum * 31 + 67) | 0;
  if (x instanceof K67) sum = (sum * 31 + 68) | 0;
  if (x instanceof K68) sum = (sum * 31 + 69) | 0;
  if (x instanceof K69) sum = (sum * 31 + 70) | 0;
  return sum;
}

function instanceSumOfRoot(x: K0): number {
  let sum = 0;
  if (x instanceof K0) sum = (sum * 31 + 1) | 0;
  if (x instanceof K1) sum = (sum * 31 + 2) | 0;
  if (x instanceof K2) sum = (sum * 31 + 3) | 0;
  if (x instanceof K3) sum = (sum * 31 + 4) | 0;
  if (x instanceof K4) sum = (sum * 31 + 5) | 0;
  if (x instanceof K5) sum = (sum * 31 + 6) | 0;
  if (x instanceof K6) sum = (sum * 31 + 7) | 0;
  if (x instanceof K7) sum = (sum * 31 + 8) | 0;
  if (x instanceof K8) sum = (sum * 31 + 9) | 0;
  if (x instanceof K9) sum = (sum * 31 + 10) | 0;
  if (x instanceof K10) sum = (sum * 31 + 11) | 0;
  if (x instanceof K11) sum = (sum * 31 + 12) | 0;
  if (x instanceof K12) sum = (sum * 31 + 13) | 0;
  if (x instanceof K13) sum = (sum * 31 + 14) | 0;
  if (x instanceof K14) sum = (sum * 31 + 15) | 0;
  if (x instanceof K15) sum = (sum * 31 + 16) | 0;
  if (x instanceof K16) sum = (sum * 31 + 17) | 0;
  if (x instanceof K17) sum = (sum * 31 + 18) | 0;
  if (x instanceof K18) sum = (sum * 31 + 19) | 0;
  if (x instanceof K19) sum = (sum * 31 + 20) | 0;
  if (x instanceof K20) sum = (sum * 31 + 21) | 0;
  if (x instanceof K21) sum = (sum * 31 + 22) | 0;
  if (x instanceof K22) sum = (sum * 31 + 23) | 0;
  if (x instanceof K23) sum = (sum * 31 + 24) | 0;
  if (x instanceof K24) sum = (sum * 31 + 25) | 0;
  if (x instanceof K25) sum = (sum * 31 + 26) | 0;
  if (x instanceof K26) sum = (sum * 31 + 27) | 0;
  if (x instanceof K27) sum = (sum * 31 + 28) | 0;
  if (x instanceof K28) sum = (sum * 31 + 29) | 0;
  if (x instanceof K29) sum = (sum * 31 + 30) | 0;
  if (x instanceof K30) sum = (sum * 31 + 31) | 0;
  if (x instanceof K31) sum = (sum * 31 + 32) | 0;
  if (x instanceof K32) sum = (sum * 31 + 33) | 0;
  if (x instanceof K33) sum = (sum * 31 + 34) | 0;
  if (x instanceof K34) sum = (sum * 31 + 35) | 0;
  if (x instanceof K35) sum = (sum * 31 + 36) | 0;
  if (x instanceof K36) sum = (sum * 31 + 37) | 0;
  if (x instanceof K37) sum = (sum * 31 + 38) | 0;
  if (x instanceof K38) sum = (sum * 31 + 39) | 0;
  if (x instanceof K39) sum = (sum * 31 + 40) | 0;
  if (x instanceof K40) sum = (sum * 31 + 41) | 0;
  if (x instanceof K41) sum = (sum * 31 + 42) | 0;
  if (x instanceof K42) sum = (sum * 31 + 43) | 0;
  if (x instanceof K43) sum = (sum * 31 + 44) | 0;
  if (x instanceof K44) sum = (sum * 31 + 45) | 0;
  if (x instanceof K45) sum = (sum * 31 + 46) | 0;
  if (x instanceof K46) sum = (sum * 31 + 47) | 0;
  if (x instanceof K47) sum = (sum * 31 + 48) | 0;
  if (x instanceof K48) sum = (sum * 31 + 49) | 0;
  if (x instanceof K49) sum = (sum * 31 + 50) | 0;
  if (x instanceof K50) sum = (sum * 31 + 51) | 0;
  if (x instanceof K51) sum = (sum * 31 + 52) | 0;
  if (x instanceof K52) sum = (sum * 31 + 53) | 0;
  if (x instanceof K53) sum = (sum * 31 + 54) | 0;
  if (x instanceof K54) sum = (sum * 31 + 55) | 0;
  if (x instanceof K55) sum = (sum * 31 + 56) | 0;
  if (x instanceof K56) sum = (sum * 31 + 57) | 0;
  if (x instanceof K57) sum = (sum * 31 + 58) | 0;
  if (x instanceof K58) sum = (sum * 31 + 59) | 0;
  if (x instanceof K59) sum = (sum * 31 + 60) | 0;
  if (x instanceof K60) sum = (sum * 31 + 61) | 0;
  if (x instanceof K61) sum = (sum * 31 + 62) | 0;
  if (x instanceof K62) sum = (sum * 31 + 63) | 0;
  if (x instanceof K63) sum = (sum * 31 + 64) | 0;
  if (x instanceof K64) sum = (sum * 31 + 65) | 0;
  if (x instanceof K65) sum = (sum * 31 + 66) | 0;
  if (x instanceof K66) sum = (sum * 31 + 67) | 0;
  if (x instanceof K67) sum = (sum * 31 + 68) | 0;
  if (x instanceof K68) sum = (sum * 31 + 69) | 0;
  if (x instanceof K69) sum = (sum * 31 + 70) | 0;
  return sum;
}

function tagOf(x: K0): number {
  return x.tag();
}

function markOf(x: Marked): number {
  return x.mark();
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).name;
  }
}

function pairSum(instances: K0[]): number {
  let sum = 0;
  for (const instance of instances) {
    for (const K of classes) sum = (sum * 31 + (instance instanceof K ? 1 : 2)) | 0;
    sum = (sum * 31 + tagOf(instance)) | 0;
    sum = (sum + instanceSumOfRoot(instance)) | 0;
    sum = (sum + instanceSumOfUnknown(instance)) | 0;
  }
  return sum;
}

const instances: K0[] = classes.map(K => new K());
console.log("every pair:", pairSum(instances));

const marked = instances.filter((_, index) => index % 3 === 0 && index > 0) as unknown as Marked[];
console.log("marked:", marked.reduce((sum, instance) => (sum * 31 + markOf(instance)) | 0, 0));

const extended = classes.map(K => {
  const instance = new K();
  (instance as any).extra = 1;
  return instance;
});
console.log("extra property:", pairSum(extended));

const reparented = classes.map((K, index) => {
  const instance = new K();
  Object.setPrototypeOf(instance, classes[(index * 11 + 5) % classes.length].prototype);
  return instance;
});
console.log("changed prototype:", pairSum(reparented));

const deleted = classes.map(K => {
  const instance = new K();
  delete (instance as any).base;
  return instance;
});
console.log("deleted field:", pairSum(deleted), deleted[9].base);

const others: [string, unknown][] = [
  ["plain object", { base: 0 }],
  ["object with tag", { tag: () => 99 }],
  ["array", [1, 2, 3]],
  ["function", () => 0],
  ["class object", K7],
  ["prototype", K7.prototype],
  ["created from prototype", Object.create(K7.prototype)],
  ["null prototype", Object.create(null)],
];
for (const [name, value] of others) {
  console.log(
    name + ":",
    instanceSumOfUnknown(value),
    attempt(() => instanceSumOfRoot(value as K0)),
    attempt(() => tagOf(value as K0)),
    attempt(() => markOf(value as Marked)),
  );
}

const primitives: [string, unknown][] = [
  ["string", "text"],
  ["number", 7],
  ["BigInt", 1234567890123456789012345678901234567890n],
  ["symbol", Symbol("K")],
  ["undefined", undefined],
  ["null", null],
];
for (const [name, value] of primitives) console.log(name + ":", instanceSumOfUnknown(value));

class U0 { tag(): number { return 0; } }
class U1 extends U0 { tag(): number { return 1; } }
class U2 extends U0 { tag(): number { return 2; } }
class U3 extends U0 { tag(): number { return 3; } }
class U4 extends U2 { tag(): number { return 4; } }

function instanceSumOfUnmodified(x: U0): number {
  let sum = 0;
  if (x instanceof U0) sum = (sum * 31 + 1) | 0;
  if (x instanceof U1) sum = (sum * 31 + 2) | 0;
  if (x instanceof U2) sum = (sum * 31 + 3) | 0;
  if (x instanceof U3) sum = (sum * 31 + 4) | 0;
  if (x instanceof U4) sum = (sum * 31 + 5) | 0;
  if (x instanceof U1 || x instanceof U3) sum = (sum * 31 + 6) | 0;
  return (sum * 31 + x.tag()) | 0;
}

const unmodified: U0[] = [new U0(), new U1(), new U2(), new U3(), new U4()];
let unmodifiedSum = 0;
for (const instance of unmodified) unmodifiedSum = (unmodifiedSum * 31 + instanceSumOfUnmodified(instance)) | 0;
console.log("never modified:", unmodifiedSum);
