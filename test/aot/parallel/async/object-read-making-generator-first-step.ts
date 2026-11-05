// down0_7 makes an object, then a generator, calls a function, reads the object and only then takes the generator's first step.
class One {
  constructor(public n: number) {}
}
class Two {
  constructor(
    public one: One,
    public other: One | null,
  ) {}
}
class Three {
  constructor(
    public n: number,
    public label: string,
    public one: One,
  ) {}
}
class Seven {
  a: number;
  b: string;
  c: One;
  d: Two | null;
  e: number;
  f: number[];
  g: Three;
  constructor(n: number) {
    this.a = n | 0;
    this.b = String(n & 1023);
    this.c = new One(n + 1);
    this.d = n & 1 ? new Two(this.c, n & 2 ? new One(n + 2) : null) : null;
    this.e = n * 0.5;
    this.f = [n, n * 0.25];
    this.g = new Three(n + 3, "g" + (n & 31), new One(n + 4));
  }
}
function text(v: string): number {
  return (v.length * 131 + v.charCodeAt(v.length - 1)) | 0;
}
function one(v: One): number {
  return v.n | 0;
}
function two(v: Two | null): number {
  return v === null ? 5 : (v.one.n * 3 + (v.other === null ? 7 : v.other.n)) | 0;
}
function three(v: Three): number {
  return (v.n ^ text(v.label) ^ (v.one.n * 17)) | 0;
}
function seven(v: Seven): number {
  return (v.a + text(v.b) + one(v.c) + two(v.d) + ((v.e * 2) | 0) + v.f.length + ((v.f[1] * 4) | 0) + three(v.g)) | 0;
}
function make(n: number): Three {
  return new Three(n | 0, String(n & 4095), new One((n + 1) | 0));
}
function* counts(from: number): Generator<One, number, unknown> {
  for (let i = from; ; i++) yield new One(i);
}
function step(v: Generator<One, number, unknown>): number {
  const result = v.next();
  return result.done ? -1 : result.value.n | 0;
}
function churn(n: number): number {
  let sum = 0;
  return sum;
}
async function refuses(x: number): Promise<number> {
  throw make(x);
}
function immediate(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}
function message(x: number): Promise<number> {
  return new Promise(resolve => {
  });
}
const others = new BroadcastChannel("every-kind-of-job");
function down0_0(carried: Three, work: number): number {
  const m0: { a: One; b: number } = { a: new One(55), b: (55) * 0.5 };
  const m1: Generator<One, number, unknown> = counts(work);
  const m2: One = new One(carried.n);
  const below = down0_8(carried, work);
  return (below + three(carried) + (one(m0.a) + ((m0.b * 2) | 0)) + step(m1) + one(m2)) | 0;
}
function down0_8(carried: Three, work: number): number {
  const m0: Three = make(work);
  const below = churn(work);
  return (below + three(carried) + three(m0)) | 0;
}
async function helper1_0(k: number): Promise<number> {
  let sum = k | 0;
  let h34: Generator<One, number, unknown> = counts(k);
let h35: Map<number, Three> = new Map([[1, make((sum & 255))], [2, make(5)]]);
try {
{
 sum = (sum + (await new Promise<number>(done => {
 void message((sum & 255)).then(v => {
 const w38 = down0_0(make(k), 3);
 }
);
 }
))) | 0;
 }
}
 finally {
}
  return (sum + step(h34) + (h35.size + three(h35.get(1)!))) | 0;
}
async function up0(k: number): Promise<number> {
  const m0: () => number = (held => () => three(held) + 1)(make(k));
  const m1: Set<One> = new Set([new One(69), new One(0)]);
  const below = (await immediate(), churn(30));
  return (below + m0() + (m1.size * 5 + one([...m1][0]))) | 0;
}
async function task0(k: number): Promise<number> {
  let sum = k | 0;
  for (let c40 = 0;
 c40 < 4;
 c40++) {
 sum = (sum + (await Promise.allSettled([up0(k), helper1_0(k + 1), helper1_0(k + 2), up0(k + 3), refuses(k)])).length) | 0;
 }
  return (sum) | 0;
}
const started0 = Array.from({ length: 8 }, (_, k) => task0(k));
async function task1(k: number): Promise<number> {
  let sum = k | 0;
  let h49: {
 a: One;
 b: Two;
 c: string;
 d: number;
 e: Three }
 = {
 a: new One(k), b: new Two(new One(2), null), c: String(k), d: 62, e: make(k) }
let h50: bigint = BigInt(38) * 1000000007n + 12345678901234567890n;
let h51: symbol = Symbol("y" + (24));
let h52: RegExp = new RegExp("a" + ((k) & 7) + "+");
let h53: unknown = make(k);
let h54: Two | null = (k) & 1 ? new Two(new One(k), new One(1)) : null;
let h55: Error = new RangeError("e" + (k));
let h56: unknown = new Seven((k + sum));
let h57: RegExp = new RegExp("a" + (((k + sum)) & 7) + "+");
let h58: number[] = [k, (k) * 0.25, 6];
let h59: Three = make(sum);
let h60: Generator<One, number, unknown> = counts((sum & 255));
let h61: unknown = new Map([[1, make((k + sum))], [2, make(0)]]);
let h62: Three = make(k);
let h63: number[] = [k, (k) * 0.25, 5];
let h64: string = ("abcdefgh" + ((sum & 255))).slice(2);
let h65: unknown = BigInt((sum & 255)) * 1000000007n + 12345678901234567890n;
let h66: Float64Array = new Float64Array([(k + sum), ((k + sum)) * 0.125]);
let h67: number[] = [(sum & 255), ((sum & 255)) * 0.25, 6];
let h68: bigint = BigInt((sum & 255)) * 1000000007n + 12345678901234567890n;
let h69: Two = new Two(new One(sum), null);
let h70: One[] = [new One(k), new One(0)];
let h71: Float64Array = new Float64Array([(k + sum), ((k + sum)) * 0.125]);
let h72: symbol = Symbol("y" + ((sum & 255)));
let h73: Three = make(sum);
let h74: Three = make(41);
let h75: string = (sum).toString(36);
let h76: Float64Array = new Float64Array([45, (45) * 0.125]);
let h77: unknown = {
 a: new One(k), b: (k) * 0.5 }
let h78: RegExp = new RegExp("a" + ((k) & 7) + "+");
let h79: string = ((sum & 255)).toString(36);
let h80: unknown = {
 a: new One(39), b: (39) * 0.5 }
let h81: unknown = {
 a: new One(k), b: (k) * 0.5 }
let h82: unknown = new One(31);
let h83: One = new One(k);
let h84: Error = new RangeError("e" + (k));
let h85: Two = new Two(new One(k), null);
let h86: Error = new RangeError("e" + (sum));
let h87: Three = make((k + sum));
let h88: Seven = new Seven(k);
let h89: RegExp = new RegExp("a" + (((k + sum)) & 7) + "+");
let h90: () => number = (held => () => three(held) + 1)(make(k));
let h91: string = ("abcdefgh" + (40)).slice(2);
let h92: unknown = (k) & 1 ? new Two(new One(k), new One(1)) : null;
let h93: Three = new Three((k + sum), "t" + ((k + sum)), new One(89));
let h94: One[] = [new One((sum & 255)), new One(54)];
let h95: number[] = [(sum & 255), ((sum & 255)) * 0.25, 2];
let h96: Map<number, Three> = new Map([[1, make(sum)], [2, make(8)]]);
let h97: unknown = [(sum & 255), ((sum & 255)) * 0.25, 5];
let h98: unknown = new Float64Array([44, (44) * 0.125]);
let h99: Two = new Two(new One(k), null);
let h100: Seven = new Seven(sum);
let h101: unknown = new RangeError("e" + (sum));
let h102: Seven = new Seven((sum & 255));
let h103: () => number = (held => () => three(held) + 1)(make(14));
let h104: unknown = make((k + sum));
let h105: {
 a: One;
 b: Two;
 c: string;
 d: number;
 e: Three }
 = {
 a: new One(sum), b: new Two(new One(2), null), c: String(sum), d: 16, e: make(sum) }
let h106: unknown = new Set([new One(9), new One(3)]);
let h107: Seven = new Seven(sum);
let h108: bigint = BigInt(22) * 1000000007n + 12345678901234567890n;
let h109: symbol = Symbol("y" + ((k + sum)));
let h110: One[] = [new One((k + sum)), new One(50), new One(3)];
let h111: Generator<One, number, unknown> = counts(14);
let h112: {
 a: One;
 b: number }
 = {
 a: new One(k), b: (k) * 0.5 }
let h113: Float64Array = new Float64Array([(sum & 255), ((sum & 255)) * 0.125]);
let h114: Seven = new Seven(sum);
let h115: One[] = [new One((sum & 255)), new One(67), new One(2)];
let h116: One = new One(sum);
let h117: bigint = BigInt((k + sum)) * 1000000007n + 12345678901234567890n;
let h118: string = "s" + (k);
  return (sum + (one(h49.a) + two(h49.b) + text(h49.c) + h49.d + three(h49.e)) + Number(h50 % 1000003n) + text(h51.description ?? "") + text(h52.source) + three((h53 as Three)) + two(h54) + text(h55.message) + seven((h56 as Seven)) + text(h57.source) + (h58.length + ((h58[1] * 4) | 0)) + three(h59) + step(h60) + ((h61 as Map<number, Three>).size + three((h61 as Map<number, Three>).get(1)!)) + three(h62) + (h63.length + ((h63[1] * 4) | 0)) + text(h64) + Number((h65 as bigint) % 1000003n) + ((h66[1] * 8) | 0) + (h67.length + ((h67[1] * 4) | 0)) + Number(h68 % 1000003n) + two(h69) + (h70.length * 3 + one(h70[h70.length - 1])) + ((h71[1] * 8) | 0) + text(h72.description ?? "") + three(h73) + three(h74) + text(h75) + ((h76[1] * 8) | 0) + (one((h77 as { a: One; b: number }).a) + (((h77 as { a: One; b: number }).b * 2) | 0)) + text(h78.source) + text(h79) + (one((h80 as { a: One; b: number }).a) + (((h80 as { a: One; b: number }).b * 2) | 0)) + (one((h81 as { a: One; b: number }).a) + (((h81 as { a: One; b: number }).b * 2) | 0)) + one((h82 as One)) + one(h83) + text(h84.message) + two(h85) + text(h86.message) + three(h87) + seven(h88) + text(h89.source) + h90() + text(h91) + two((h92 as (Two | null))) + three(h93) + (h94.length * 3 + one(h94[h94.length - 1])) + (h95.length + ((h95[1] * 4) | 0)) + (h96.size + three(h96.get(1)!)) + ((h97 as number[]).length + (((h97 as number[])[1] * 4) | 0)) + (((h98 as Float64Array)[1] * 8) | 0) + two(h99) + seven(h100) + text((h101 as Error).message) + seven(h102) + h103() + three((h104 as Three)) + (one(h105.a) + two(h105.b) + text(h105.c) + h105.d + three(h105.e)) + ((h106 as Set<One>).size * 5 + one([...(h106 as Set<One>)][0])) + seven(h107) + Number(h108 % 1000003n) + text(h109.description ?? "") + (h110.length * 3 + one(h110[h110.length - 1])) + step(h111) + (one(h112.a) + ((h112.b * 2) | 0)) + ((h113[1] * 8) | 0) + seven(h114) + (h115.length * 3 + one(h115[h115.length - 1])) + one(h116) + Number(h117 % 1000003n) + text(h118)) | 0;
}
const started1 = Array.from({ length: 19 }, (_, k) => task1(k));
{
  others.close();
}
console.log("built and ran");
