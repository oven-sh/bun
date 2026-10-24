// For the end of the link and for its limits: a function whose answer goes back into its own operands, three functions in a ring, an operator applied once more at each level, forty different literals out of one function (more than a list of origins holds), and callers that compute with what comes out.
function g(n: number, a: number): number {
  return n ? g(n - 1, [a, g(n >> 1, a + 1)][n & 1]) : a;
}
function grows(n: number, a: number): number {
  return n === 0 ? a : grows(n - 1, a + 1);
}
function growsText(n: number, a: string): string {
  return n === 0 ? a : growsText(n - 1, a + "x");
}
function changesKind(n: number, a: number | string): number | string {
  return n === 0 ? a : changesKind(n - 1, n === 3 ? a + "!" : (a as number) * 2);
}
function ringA(n: number, a: number, b: number): number {
  return n <= 0 ? a : ringB(n - 1, b, a + 1);
}
function ringB(n: number, a: number, b: number): number {
  return n <= 0 ? b : ringC(n - 1, ringA(n - 2, a, b), b);
}
function ringC(n: number, a: number, b: number): number {
  return n <= 0 ? a - b : ringA(n - 1, b * 2, a);
}
function wrapsItself(n: number, o: { inner: unknown }): { inner: unknown } {
  return n === 0 ? o : wrapsItself(n - 1, { inner: o });
}
function unwrapsItself(n: number, o: { inner: any }): unknown {
  return n === 0 ? o : unwrapsItself(n - 1, o.inner);
}
function ackermann(m: number, n: number): number {
  return m === 0 ? n + 1 : n === 0 ? ackermann(m - 1, 1) : ackermann(m - 1, ackermann(m, n - 1));
}
function overflowsOnTheWay(n: number, a: number): number {
  return n === 0 ? a : overflowsOnTheWay(n - 1, a * 2);
}
function neverReturns(n: number): number {
  if (n > 50) throw new Error("stopped at " + n);
  return neverReturns(n + 1);
}
function returnsOnlyThroughItself(n: number): number {
  return n > 3 ? returnsOnlyThroughItself(n - 1) : returnsOnlyThroughItself2(n);
}
function returnsOnlyThroughItself2(n: number): number {
  return n > 0 ? returnsOnlyThroughItself(n - 1) : 42;
}
console.log(g(0, 1), g(1, 1), g(5, 1), g(9, 0), grows(10, 0), grows(3, 2147483646), grows(2, 0.5), growsText(3, "a"), changesKind(2, 1), changesKind(5, 1), changesKind(3, 1));
console.log(ringA(0, 1, 2), ringA(1, 1, 2), ringA(2, 1, 2), ringA(5, 1, 2), ringA(9, 1, 2), ringB(4, 3, 4), ringC(6, 1, 1), ackermann(2, 3), overflowsOnTheWay(31, 1), overflowsOnTheWay(32, 1), overflowsOnTheWay(64, 1), overflowsOnTheWay(1100, 1), overflowsOnTheWay(31, -1), returnsOnlyThroughItself(9));
const seed = { inner: "seed" };
const wrapped = wrapsItself(12, seed);
console.log(unwrapsItself(12, wrapped) === seed, unwrapsItself(13, wrapped), wrapsItself(0, seed) === seed, wrapsItself(1, seed) === seed, JSON.stringify(wrapsItself(2, seed)));
try {
  neverReturns(0);
} catch (error) {
  console.log((error as Error).message);
}

// Forty literals.
function forty(n: number): number | string {
  switch (n) {
    case 0: return 100;
    case 1: return 101;
    case 2: return 102;
    case 3: return 103;
    case 4: return 104;
    case 5: return 105;
    case 6: return 106;
    case 7: return 107;
    case 8: return 108;
    case 9: return 109;
    case 10: return 110;
    case 11: return 111;
    case 12: return 112;
    case 13: return 113;
    case 14: return 114;
    case 15: return 115;
    case 16: return 116;
    case 17: return 117;
    case 18: return 118;
    case 19: return 119;
    case 20: return 120;
    case 21: return 121;
    case 22: return 122;
    case 23: return 123;
    case 24: return 124;
    case 25: return 125;
    case 26: return 126;
    case 27: return 127;
    case 28: return 128;
    case 29: return 129;
    case 30: return 130;
    case 31: return 131;
    case 32: return 132;
    case 33: return 133.5;
    case 34: return 2147483647;
    case 35: return -0;
    case 36: return NaN;
    case 37: return "thirty-seven";
    case 38: return 1e300;
    default: return "the last";
  }
}
function fortyPlusOne(n: number): number | string {
  return (forty(n) as number) + 1;
}
function isSmall(n: number): boolean {
  return (forty(n) as number) < 133;
}
function kindOfForty(n: number): string {
  return typeof forty(n);
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += (fortyPlusOne(i % 33) as number) + (isSmall(i % 33) ? 1 : 0) + kindOfForty(i % 33).length;
console.log(sum);
console.log([31, 32, 33, 34, 35, 36, 37, 38, 39].map(n => fortyPlusOne(n) + "/" + isSmall(n) + "/" + kindOfForty(n)).join(" "));
console.log(Object.is(forty(35), -0), 1 / (forty(35) as number), forty(36) === forty(36), fortyPlusOne(34));

// Thirty-three, thirty-two, thirty-one: around the limit.
function around(n: number, limit: number): unknown {
  if (n >= limit) return "past the limit";
  return forty(n);
}
console.log(typeof around(30, 31), typeof around(31, 31), typeof around(31, 32), typeof around(32, 32), typeof around(32, 33), typeof around(33, 33));

// An operator nine, ten levels deep in one expression, and through nine functions.
const l1 = (a: number) => a + 1;
const l2 = (a: number) => l1(a) * 2;
const l3 = (a: number) => l2(a) - 3;
const l4 = (a: number) => l3(a) * l3(a);
const l5 = (a: number) => l4(a) + l1(a);
const l6 = (a: number) => l5(a) * 1000;
const l7 = (a: number) => l6(a) * 1000;
const l8 = (a: number) => l7(a) * 1000;
const l9 = (a: number) => l8(a) / 7;
const l10 = (a: number) => -l9(a) % 5;
console.log(l5(1), l6(1), l7(1), l8(1), l8(50), l9(1), l10(1), l10(-1), Object.is(l10(0.5), -0), l4("2" as unknown as number), l1("2" as unknown as number), l2("2" as unknown as number));
