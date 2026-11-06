// `switch` statements in which many integer cases lead to the same few targets: predicates over an enum, small classifiers. Every
// function is called with every integer around its cases, with the ends of the 32-bit range, and with values that are not integers.
const enum Kind { A = 170, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P }

function oneTarget(k: number): boolean {
  switch (k) { case 3: case 5: case 6: case 9: case 12: case 13: case 20: case 31: return true; default: return false; }
}
function startsAtZero(k: number): boolean {
  switch (k) { case 0: case 1: case 4: case 7: case 8: case 30: return true; }
  return false;
}
function spanOf32(k: number): number {
  switch (k) { case 100: case 103: case 110: case 131: return 1; case 101: case 120: case 130: return 2; default: return 0; }
}
function spanOf33(k: number): number {
  switch (k) { case 100: case 103: case 110: case 132: return 1; case 101: case 120: case 131: return 2; default: return 0; }
}
function spanOf64(k: number): number {
  switch (k) { case -10: case -7: case 0: case 20: case 53: return 1; case -9: case 1: case 33: case 52: return 2; default: return 0; }
}
function spanOf65(k: number): number {
  switch (k) { case -10: case -7: case 0: case 20: case 54: return 1; case -9: case 1: case 33: case 52: return 2; default: return 0; }
}
function threeTargets(k: number): string {
  switch (k) {
    case 10: case 12: case 14: case 16: return "even";
    case 11: case 13: case 15: return "odd";
    case 20: case 21: case 25: return "far";
    default: return "none";
  }
}
function fourTargets(k: number): string {
  switch (k) {
    case 10: case 12: case 14: return "a";
    case 11: case 13: case 15: return "b";
    case 20: case 21: case 25: return "c";
    case 30: case 31: case 35: return "d";
    default: return "none";
  }
}
function everyValueOfARange(k: number): number {
  switch (k) { case 40: case 42: case 44: case 46: return 1; case 41: case 43: case 45: case 47: return 2; }
  return 0;
}
function wide(k: number): boolean {
  switch (k) {
    case 174: case 175: case 176: case 177: case 178: case 181: case 182: case 185: case 186: case 195: case 201: case 219: case 220:
    case 242: case 249: case 250: case 251: case 263: case 266: case 268: case 270: case 300: case 308: case 318: case 324: case 339: case 341: case 347:
      return true;
    default:
      return false;
  }
}
function fallsThrough(k: number): number {
  let t = 0;
  switch (k) {
    case 1: case 2: case 3: t += 1;
    case 4: case 5: case 6: t += 10; break;
    case 7: case 8: case 9: case 10: t += 100;
    default: t += 1000;
  }
  return t;
}
function defaultInTheMiddle(k: number): string {
  switch (k) { case 1: case 3: case 5: case 7: return "odd"; default: return "other"; case 2: case 4: case 6: case 8: return "even"; }
}
function nearTheEnds(k: number): number {
  switch (k) {
    case 2147483647: case 2147483645: case 2147483640: case 2147483630: case 2147483620: return 1;
    case -2147483648: case -2147483646: case -2147483640: case -2147483630: case -2147483620: return 2;
    default: return 0;
  }
}
function ofAnEnum(k: Kind): boolean {
  switch (k) { case Kind.A: case Kind.C: case Kind.D: case Kind.H: case Kind.L: case Kind.P: return true; default: return false; }
}
function inALoop(from: number, to: number): number {
  let t = 0;
  for (let k = from; k < to; k++) {
    switch (k & 63) { case 1: case 2: case 8: case 9: case 33: case 62: t += 3; break; case 4: case 5: case 40: case 41: case 63: t -= 1; break; }
  }
  return t;
}
function ofAnything(k: any): string {
  switch (k) { case 1: case 2: case 5: case 6: case 9: return "low"; case 3: case 7: case 8: case 11: return "mixed"; default: return "none"; }
}

const functions: Array<[string, (k: number) => unknown, number, number]> = [
  ["oneTarget", oneTarget, -3, 70], ["startsAtZero", startsAtZero, -3, 70], ["spanOf32", spanOf32, 95, 170], ["spanOf33", spanOf33, 95, 170],
  ["spanOf64", spanOf64, -80, 125], ["spanOf65", spanOf65, -80, 125], ["threeTargets", threeTargets, 5, 80], ["fourTargets", fourTargets, 5, 105],
  ["everyValueOfARange", everyValueOfARange, 35, 115], ["wide", wide, 165, 420], ["fallsThrough", fallsThrough, -2, 70], ["defaultInTheMiddle", defaultInTheMiddle, -2, 75],
];
for (const [name, f, from, to] of functions) {
  let line = "";
  for (let k = from; k <= to; k++) { const r = f(k); line += r === true ? "T" : r === false ? "." : typeof r === "string" ? r[0] : String(r) + ","; }
  const odd = [0.5, -0, NaN, Infinity, -Infinity, 4294967296 + 5, 4294967296 + 100, -4294967296 + 12, 2147483648, -2147483649, 1e300, 5.000001].map(x => String(f(x))).join();
  console.log(name, line, odd);
}
const kinds: Kind[] = [Kind.A, Kind.B, Kind.C, Kind.D, Kind.E, Kind.F, Kind.G, Kind.H, Kind.I, Kind.J, Kind.K, Kind.L, Kind.M, Kind.N, Kind.O, Kind.P];
console.log("ofAnEnum", kinds.map(k => (ofAnEnum(k) ? "T" : ".")).join(""));
let ends = "";
for (let d = 0; d <= 70; d++) ends += nearTheEnds(2147483647 - d) + "" + nearTheEnds(-2147483648 + d);
console.log("nearTheEnds", ends, nearTheEnds(0), nearTheEnds(2147483648), nearTheEnds(-2147483649));
console.log("inALoop", inALoop(0, 1000), inALoop(-500, 500), inALoop(2147483000, 2147483647));
console.log("ofAnything", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, "1", "5", null, undefined, true, 1.5, -0, 0, NaN, {}, [3], 9n, 4294967297].map(ofAnything).join());
