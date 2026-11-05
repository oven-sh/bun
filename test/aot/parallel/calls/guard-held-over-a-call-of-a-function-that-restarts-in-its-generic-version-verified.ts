// Flags: --aot-check=verify-each-stage
// spin() holds the test of a list over a call of text(), whose rare path starts again in its generic version. That version calls by name what text() has resolved, and does no more. As a fuzzer reduced it.
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
class Branch {
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
  for (let i = 0; i < n; i++) {
  }
}
function grow(depth: number, n: number): Branch {
  if (depth > 0) {
  }
}
async function later(x: number): Promise<number> {
}
async function laterThree(x: number): Promise<Three> {
}
async function refuses(x: number): Promise<number> {
  throw make(x);
}
function timer(ms: number): Promise<void> {
}
function message(x: number): Promise<number> {
  return new Promise(resolve => {
    port1.onmessage = event => {
    };
  });
}
function gate(): Promise<number> {
}
function open(value: number): void {
}
function unlock(): void {
}
const others = new BroadcastChannel("all-microtask-kinds");
function shout(): void {
}
function thenable(run: (v: number) => number): PromiseLike<number> {
  const made = {
  };
}
function stored(): number {
}
async function thrownInto(stream: AsyncGenerator<Three, number, unknown>, x: number): Promise<number> {
  try {
  } catch (thrown) {
  }
}
function take(): number {
}
const ring0: ((One) | null)[] = new Array(257).fill(null);
const ring1: ((One) | null)[] = new Array(257).fill(null);
const ring2: ((Two) | null)[] = new Array(257).fill(null);
const ring3: ((Two | null) | null)[] = new Array(257).fill(null);
const ring4: ((Three) | null)[] = new Array(257).fill(null);
const ring5: ((Three) | null)[] = new Array(257).fill(null);
const ring6: ((Seven) | null)[] = new Array(257).fill(null);
const ring7: ((string) | null)[] = new Array(257).fill(null);
const ring9: ((symbol) | null)[] = new Array(257).fill(null);
const ring10: ((() => number) | null)[] = new Array(257).fill(null);
const ring11: ((One[]) | null)[] = new Array(257).fill(null);
const ring14: ((Set<One>) | null)[] = new Array(257).fill(null);
const ring15: (({ a: One; b: number }) | null)[] = new Array(257).fill(null);
const ring16: (({ a: One; b: Two; c: string; d: number; e: Three }) | null)[] = new Array(257).fill(null);
const ring17: ((Generator<One, number, unknown>) | null)[] = new Array(257).fill(null);
const ring20: ((Error) | null)[] = new Array(257).fill(null);
const ring21: ((RegExp) | null)[] = new Array(257).fill(null);
let spun = 0;
let spinSum = 0;
function spin(n: number): number {
  for (let i = 0; i < n; i++) {
    const round = spun++;
    const slot = round % 257;
    const old0 = ring0[slot];
    if (old0 !== null) spinSum = (spinSum + one(old0)) | 0;
    ring0[slot] = new One(round);
    const old1 = ring1[slot];
    if (old1 !== null) spinSum = (spinSum + one(old1)) | 0;
    ring1[slot] = new One(round);
    const old2 = ring2[slot];
    if (old2 !== null) spinSum = (spinSum + two(old2)) | 0;
    ring2[slot] = new Two(new One(round), null);
    const old3 = ring3[slot];
    if (old3 !== null) spinSum = (spinSum + two(old3)) | 0;
    ring3[slot] = (round) & 1 ? new Two(new One(round), new One(1)) : null;
    const old4 = ring4[slot];
    if (old4 !== null) spinSum = (spinSum + three(old4)) | 0;
    ring4[slot] = new Three(round, "t" + (round), new One(22));
    const old5 = ring5[slot];
    if (old5 !== null) spinSum = (spinSum + three(old5)) | 0;
    ring5[slot] = make(round);
    const old6 = ring6[slot];
    if (old6 !== null) spinSum = (spinSum + seven(old6)) | 0;
    ring6[slot] = new Seven(round);
    const old7 = ring7[slot];
    if (old7 !== null) spinSum = (spinSum + text(old7)) | 0;
    ring7[slot] = ("abcdefgh" + (round)).slice(2);
    const old9 = ring9[slot];
    if (old9 !== null) spinSum = (spinSum + text(old9.description ?? "")) | 0;
    ring9[slot] = Symbol("y" + (round));
    const old10 = ring10[slot];
    if (old10 !== null) spinSum = (spinSum + old10()) | 0;
    ring10[slot] = (held => () => three(held) + 1)(make(round));
    const old11 = ring11[slot];
    if (old11 !== null) spinSum = (spinSum + (old11.length * 3 + one(old11[old11.length - 1]))) | 0;
    ring11[slot] = [new One(round), new One(24), new One(2)];
    const old14 = ring14[slot];
    if (old14 !== null) spinSum = (spinSum + (old14.size * 5 + one([...old14][0]))) | 0;
    ring14[slot] = new Set([new One(round), new One(1)]);
    const old15 = ring15[slot];
    if (old15 !== null) spinSum = (spinSum + (one(old15.a) + ((old15.b * 2) | 0))) | 0;
    ring15[slot] = { a: new One(round), b: (round) * 0.5 };
    const old16 = ring16[slot];
    if (old16 !== null) spinSum = (spinSum + (one(old16.a) + two(old16.b) + text(old16.c) + old16.d + three(old16.e))) | 0;
    ring16[slot] = { a: new One(round), b: new Two(new One(2), null), c: String(round), d: 10, e: make(round) };
    const old17 = ring17[slot];
    if (old17 !== null) spinSum = (spinSum + step(old17)) | 0;
    ring17[slot] = counts(round);
    const old20 = ring20[slot];
    if (old20 !== null) spinSum = (spinSum + text(old20.message)) | 0;
    ring20[slot] = new RangeError("e" + (round));
    const old21 = ring21[slot];
    if (old21 !== null) spinSum = (spinSum + text(old21.source)) | 0;
    ring21[slot] = new RegExp("a" + ((round) & 7) + "+");
  }
  return n;
}
function down0_0(carried: Three, work: number): number {
}
function down0_1(carried: Three, work: number): number {
}
function down0_2(carried: Three, work: number): number {
}
function down0_3(carried: Three, work: number): number {
}
function down0_4(carried: Three, work: number): number {
}
function down0_5(carried: Three, work: number): number {
}
function down0_6(carried: Three, work: number): number {
}
function down0_7(carried: Three, work: number): number {
}
function down0_8(carried: Three, work: number): number {
}
function down0_9(carried: Three, work: number): number {
}
function down0_10(carried: Three, work: number): number {
}
function down0_11(carried: Three, work: number): number {
}
async function helper0_0(k: number): Promise<number> {
{
 sum = (sum + (await refuses((sum & 255)).then(v => v, (thrown: unknown) => {
 return (() => {
 const s2: {
 e: Three }
 = {
 a: new One(v), b: new Two(new One(2), null), c: String(v), d: 71, e: make(v) }
 }
)();
 }
))) | 0;
 }
}
async function helper0_1(k: number): Promise<number> {
let h6: {
 e: Three }
 = {
 a: new One((k + sum)), b: new Two(new One(2), null), c: String((k + sum)), d: 58, e: make((k + sum)) }
for (let c7 = 0;
 c7 < 4;
 c7++) {
if (sum & 1) {
}
 else {
}
}
}
async function helper0_2(k: number): Promise<number> {
{
 sum = (sum + (await new Promise<number>(done => queueMicrotask(() => {
 done((() => {
 }
)());
 }
)))) | 0;
 }
}
async function* stream0(count: number, k: number): AsyncGenerator<Three, number, unknown> {
  for (let turn = 0; turn < count; turn++) {
  try {
}
 catch (thrown) {
}
if (sum & 1) {
{
 sum = (sum + (await new Promise<number>(done => queueMicrotask(() => {
 done((() => {
 const s15: {
 e: Three }
 = {
 a: new One(k), b: new Two(new One(2), null), c: String(k), d: 98, e: make(k) }
 }
)());
 }
)))) | 0;
 }
{
 sum = (sum + (await thenable(v => {
 const s19: {
 e: Three }
 = {
 a: new One(k), b: new Two(new One(2), null), c: String(k), d: 67, e: make(k) }
 }
))) | 0;
 }
}
{
 sum = (sum + (await new Promise<number>(done => setImmediate(() => {
 done((() => {
 const s24: {
 b: number }
 = {
 a: new One(v), b: (v) * 0.5 }
 }
)());
 }
)))) | 0;
 }
  }
}
async function* stream1(count: number, k: number): AsyncGenerator<Three, number, unknown> {
  for (let turn = 0; turn < count; turn++) {
{
 for (let c30 = 0;
 c30 < 3;
 c30++) {
 }
 }
  }
}
async function* relay(count: number, k: number): AsyncGenerator<Three, number, unknown> {
}
async function helper1_0(k: number): Promise<number> {
if ((k + sum) % 3 === 0) {
try {
{
 }
}
 finally {
}
}
 else {
}
}
async function helper1_1(k: number): Promise<number> {
  {
 sum = (sum + (await stream1(3, (sum & 255)).next().then(result => {
 return (() => {
 }
)();
 }
))) | 0;
 }
{
 sum = (sum + (await later(k).then(v => {
 }
).then(v => {
 }
))) | 0;
 }
}
async function up0(k: number): Promise<number> {
}
async function up1(k: number): Promise<number> {
}
async function up2(k: number): Promise<number> {
}
async function up3(k: number): Promise<number> {
}
async function task0(k: number): Promise<number> {
  let sum = k | 0;
  let h42: Two = new Two(new One(3), new One(21));
let h43: {
 a: One;
 b: number }
 = {
 a: new One((sum & 255)), b: ((sum & 255)) * 0.5 }
let h44: unknown = (held => () => three(held) + 1)(make(k));
let h45: Generator<One, number, unknown> = counts(k);
let h46: unknown = make(21);
let h47: Three = make((sum & 255));
let h48: string = "ab".repeat(((3) & 3) + 1);
let h49: Two | null = ((sum & 255)) & 1 ? new Two(new One((sum & 255)), new One(1)) : null;
let h50: unknown = new RangeError("e" + (sum));
let h51: string = (k).toString(36);
let h52: One = new One((k + sum));
let h53: {
 a: One;
 b: Two;
 c: string;
 d: number;
 e: Three }
 = {
 a: new One(k), b: new Two(new One(2), null), c: String(k), d: 71, e: make(k) }
let h54: Three = make((k + sum));
let h55: () => number = (held => () => three(held) + 1)(make((k + sum)));
let h56: RegExp = new RegExp("a" + ((sum) & 7) + "+");
let h57: RegExp = new RegExp("a" + ((sum) & 7) + "+");
let h58: One[] = [new One(k), new One(49)];
let h59: Three = make(k);
let h60: {
 a: One;
 b: number }
 = {
 a: new One(k), b: (k) * 0.5 }
let h61: unknown = new RangeError("e" + (k));
let h62: bigint = BigInt(sum) * 1000000007n + 12345678901234567890n;
let h63: unknown = Symbol("y" + ((k + sum)));
let h64: Three = make(k);
let h65: Set<One> = new Set([new One((sum & 255)), new One(2)]);
let h66: Three = new Three((sum & 255), "t" + ((sum & 255)), new One(93));
let h67: Two | null = (7) & 1 ? new Two(new One(7), new One(1)) : null;
let h68: unknown = (sum) & 1 ? new Two(new One(sum), new One(1)) : null;
let h69: Generator<One, number, unknown> = counts(sum);
let h70: bigint = BigInt(16) * 1000000007n + 12345678901234567890n;
let h71: One = new One(sum);
let h72: unknown = new Uint8Array([sum, 2, 3]);
let h73: Map<number, Three> = new Map([[1, make(k)], [2, make(6)]]);
let h74: {
 a: One;
 b: number }
 = {
 a: new One((k + sum)), b: ((k + sum)) * 0.5 }
let h75: unknown = (k) & 1 ? new Two(new One(k), new One(1)) : null;
let h76: Set<One> = new Set([new One((sum & 255)), new One(2)]);
let h77: unknown = (sum).toString(36);
let h78: RegExp = new RegExp("a" + ((sum) & 7) + "+");
let h79: Two = new Two(new One((sum & 255)), null);
let h80: One = new One(4);
let h81: RegExp = new RegExp("a" + ((k) & 7) + "+");
let h82: symbol = Symbol("y" + ((k + sum)));
let h83: unknown = counts((sum & 255));
let h84: symbol = Symbol("y" + (sum));
let h85: Generator<One, number, unknown> = counts((k + sum));
let h86: bigint = BigInt((k + sum)) * 1000000007n + 12345678901234567890n;
let h87: {
 a: One;
 b: number }
 = {
 a: new One((k + sum)), b: ((k + sum)) * 0.5 }
let h88: unknown = new Two(new One(k), null);
let h89: string = JSON.stringify([(sum & 255)]);
let h90: number[] = [sum, (sum) * 0.25, 2];
let h91: Uint8Array = new Uint8Array([sum, 2, 3]);
let h92: string = ("abcdefgh" + (sum)).slice(2);
let h93: One = new One(k);
let h94: RegExp = new RegExp("a" + ((sum) & 7) + "+");
let h95: Uint8Array = new Uint8Array([k, 2, 3]);
let h96: Three = make(sum);
let h97: () => number = (held => () => three(held) + 1)(make(k));
let h98: {
 a: One;
 b: number }
 = {
 a: new One(48), b: (48) * 0.5 }
let h99: Three = make(k);
let h100: Two = new Two(new One((k + sum)), new One(3));
let h101: Float64Array = new Float64Array([k, (k) * 0.125]);
let h102: Error = new RangeError("e" + ((sum & 255)));
let h103: unknown = counts(k);
let h104: unknown = [new One(sum), new One(55), new One(1)];
let h105: unknown = counts((k + sum));
let h106: {
 a: One;
 b: Two;
 c: string;
 d: number;
 e: Three }
 = {
 a: new One(sum), b: new Two(new One(2), null), c: String(sum), d: 26, e: make(sum) }
let h107: Generator<One, number, unknown> = counts(k);
let h108: {
 a: One;
 b: Two;
 c: string;
 d: number;
 e: Three }
 = {
 a: new One(k), b: new Two(new One(2), null), c: String(k), d: 81, e: make(k) }
let h109: Float64Array = new Float64Array([k, (k) * 0.125]);
let h110: Generator<One, number, unknown> = counts(47);
let h111: unknown = new One(sum);
try {
sum = (sum + spin(38)) | 0;
sum = (sum + (await refuses(20))) | 0;
}
 catch (thrown) {
}
for (let c114 = 0;
 c114 < 2;
 c114++) {
}
  return (sum + two(h42) + (one(h43.a) + ((h43.b * 2) | 0)) + (h44 as (() => number))() + step(h45) + three((h46 as Three)) + three(h47) + text(h48) + two(h49) + text((h50 as Error).message) + text(h51) + one(h52) + (one(h53.a) + two(h53.b) + text(h53.c) + h53.d + three(h53.e)) + three(h54) + h55() + text(h56.source) + text(h57.source) + (h58.length * 3 + one(h58[h58.length - 1])) + three(h59) + (one(h60.a) + ((h60.b * 2) | 0)) + text((h61 as Error).message) + Number(h62 % 1000003n) + text((h63 as symbol).description ?? "") + three(h64) + (h65.size * 5 + one([...h65][0])) + three(h66) + two(h67) + two((h68 as (Two | null))) + step(h69) + Number(h70 % 1000003n) + one(h71) + ((h72 as Uint8Array)[0] + (h72 as Uint8Array).length) + (h73.size + three(h73.get(1)!)) + (one(h74.a) + ((h74.b * 2) | 0)) + two((h75 as (Two | null))) + (h76.size * 5 + one([...h76][0])) + text((h77 as string)) + text(h78.source) + two(h79) + one(h80) + text(h81.source) + text(h82.description ?? "") + step((h83 as Generator<One, number, unknown>)) + text(h84.description ?? "") + step(h85) + Number(h86 % 1000003n) + (one(h87.a) + ((h87.b * 2) | 0)) + two((h88 as Two)) + text(h89) + (h90.length + ((h90[1] * 4) | 0)) + (h91[0] + h91.length) + text(h92) + one(h93) + text(h94.source) + (h95[0] + h95.length) + three(h96) + h97() + (one(h98.a) + ((h98.b * 2) | 0)) + three(h99) + two(h100) + ((h101[1] * 8) | 0) + text(h102.message) + step((h103 as Generator<One, number, unknown>)) + ((h104 as One[]).length * 3 + one((h104 as One[])[(h104 as One[]).length - 1])) + step((h105 as Generator<One, number, unknown>)) + (one(h106.a) + two(h106.b) + text(h106.c) + h106.d + three(h106.e)) + step(h107) + (one(h108.a) + two(h108.b) + text(h108.c) + h108.d + three(h108.e)) + ((h109[1] * 8) | 0) + step(h110) + one((h111 as One))) | 0;
}
const started0 = Array.from({ length: 400 }, (_, k) => Promise.resolve(k).then(task0));
{
  const pulse = setInterval(() => {
  }, 1);
  clearInterval(pulse);
  others.close();
}
