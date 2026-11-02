// The first time an activation is suspended, the object that keeps its frame is made: at the first await of an async function, whether it awaits a promise, a call or a step of `for await`, and at
// the creation of a generator or an async generator. Here the frames keep 0, 1, 7, 40, 300 and 2,000 values alive, as variables and as parameters, in every representation: small and large
// integers, fractions, NaN, -0 and infinities, booleans, strings of both widths, ropes and slices, objects, arrays, BigInts, symbols, closures, unions and `any`. Nothing but the suspended frame refers
// to them while the collector runs, once for the young and once for all. Frames that have ended leave holes among those that wait, later frames fill the holes, and some functions collect as soon as they go on.
// Env: BUN_JSC_verifyGC=1
declare const gc: undefined | (() => void);
declare const edenGC: undefined | (() => void);
const collect: () => void = typeof gc === "function" ? gc : () => Bun.gc(true);
const collectYoung: () => void = typeof edenGC === "function" ? edenGC : require("bun:jsc").edenGC;
const lines: string[] = [];

let state = 12345;
function next(): number {
  state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
  return state % 1000;
}
interface Box {
  value: number;
  text: string;
}
class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}
type Either = number | string | boolean | null | undefined | Box;
type Adds = (n: number) => number;
type Steps = Generator<number, number, number>;
type StepsLater = AsyncGenerator<number, number, number>;
const letters = Array.from({ length: 64 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");

function box(): Box {
  const value = next();
  return { value, text: "b" + value };
}
function fraction(): number {
  return next() / 8;
}
function narrow(): string {
  return String(next() + 1000);
}
function int(): number {
  return next() | 0;
}
function either(): Either {
  switch (next() % 6) {
    case 0:
      return next();
    case 1:
      return "e" + next();
    case 2:
      return next() > 500;
    case 3:
      return null;
    case 4:
      return undefined;
    default:
      return box();
  }
}
function flag(): boolean {
  return next() > 500;
}
function big(): bigint {
  return BigInt(next()) * 12345678901234567890123n + 1n;
}
function large(): number {
  return next() * 4294967296 + next();
}
function special(): number {
  switch (next() % 5) {
    case 0:
      return NaN;
    case 1:
      return -0;
    case 2:
      return Infinity;
    case 3:
      return -Infinity;
    default:
      return 5e-324;
  }
}
function wide(): string {
  return String.fromCharCode(0x3b1 + (next() % 24), 0x4e00 + next());
}
function rope(): string {
  return narrow() + "+" + wide() + "+" + narrow();
}
function slice(): string {
  const start = next() % 40;
  return letters.slice(start, start + 20);
}
function point(): Point {
  return new Point(next(), next() / 2);
}
function list(): number[] {
  return [next(), next() / 4, next()];
}
function mark(): symbol {
  return Symbol("m" + next());
}
function adder(): Adds {
  const by = next();
  return n => n + by;
}
function parsed(): any {
  return JSON.parse('{"p":' + next() + ',"q":[' + next() + "]}");
}

function mix(hash: number, value: number): number {
  return (hash * 31 + value) % 1000003;
}
function ofNumber(h: number, v: number): number {
  if (v !== v) return mix(h, 11);
  if (v === 0) return mix(h, 1 / v < 0 ? 13 : 17);
  if (v === Infinity || v === -Infinity) return mix(h, v > 0 ? 19 : 23);
  if (v === 5e-324) return mix(h, 29);
  return mix(h, (v * 8) % 1000003);
}
function ofText(h: number, v: string): number {
  h = mix(h, v.length);
  for (let i = 0; i < v.length; i++) h = mix(h, v.charCodeAt(i));
  return h;
}
function ofBox(h: number, v: Box): number {
  return ofText(mix(h, v.value), v.text);
}
function ofEither(h: number, v: Either): number {
  if (typeof v === "number") return ofNumber(h, v);
  if (typeof v === "string") return ofText(h, v);
  if (typeof v === "boolean") return mix(h, v ? 3 : 5);
  if (v === null) return mix(h, 7);
  if (v === undefined) return mix(h, 9);
  return ofBox(h, v);
}
function ofFlag(h: number, v: boolean): number {
  return mix(h, v ? 1 : 2);
}
function ofBig(h: number, v: bigint): number {
  return mix(h, Number(v % 1000003n));
}
function ofPoint(h: number, v: Point): number {
  return mix(mix(h, v.x), v.y * 2);
}
function ofList(h: number, v: number[]): number {
  return mix(mix(mix(mix(h, v.length), v[0]), v[1] * 4), v[2]);
}
function ofMark(h: number, v: symbol): number {
  return ofText(h, v.description ?? "");
}
function ofAdder(h: number, v: Adds): number {
  return mix(h, v(1));
}
function ofParsed(h: number, v: any): number {
  return mix(mix(h, v.p), v.q[0]);
}
function fold(h: number, b: Box, d: number, s: string, i: number, e: Either, t: boolean, g: bigint, l: number, z: number, w: string, r: string, p: string, k: Point, a: number[], y: symbol, c: Adds, x: any): number {
  h = ofBox(h, b);
  h = ofNumber(h, d);
  h = ofText(h, s);
  h = ofNumber(h, i);
  h = ofEither(h, e);
  h = ofFlag(h, t);
  h = ofBig(h, g);
  h = ofNumber(h, l);
  h = ofNumber(h, z);
  h = ofText(h, w);
  h = ofText(h, r);
  h = ofText(h, p);
  h = ofPoint(h, k);
  h = ofList(h, a);
  h = ofMark(h, y);
  h = ofAdder(h, c);
  h = ofParsed(h, x);
  return h;
}

// Whatever is made for an activation before its parameters are evaluated is old when every sixteenth one is suspended for the first time.
let ages = 0;
function age(): number {
  if (++ages % 16 === 0) collect();
  return ages;
}
async function waitsFor(gate: Promise<number>): Promise<number> {
  return (await gate) + 1;
}
async function* streamOf(gate: Promise<number>): AsyncGenerator<number, void, unknown> {
  yield 1;
  yield await gate;
  yield 3;
}

async function awaits0(gate: Promise<number>, collects: boolean): Promise<number> {
  let h = await gate;
  if (collects) collect();
  return h;
}
async function awaits1(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box();
  let h = await gate;
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
async function awaits7(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = await gate;
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function awaits40(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = await gate;
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}
async function awaits300(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope();
  let h = await gate;
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = ofBox(h, b289); h = ofNumber(h, d290); h = ofText(h, s291); h = ofNumber(h, i292); h = ofEither(h, e293); h = ofFlag(h, t294); h = ofBig(h, g295); h = ofNumber(h, l296); h = ofNumber(h, z297); h = ofText(h, w298); h = ofText(h, r299);
  return h;
}
async function awaits2000(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope(), p300 = slice(), k301 = point(), a302 = list(), y303 = mark(), c304 = adder(), x305 = parsed();
  const b306 = box(), d307 = fraction(), s308 = narrow(), i309 = int(), e310 = either(), t311 = flag(), g312 = big(), l313 = large(), z314 = special(), w315 = wide(), r316 = rope(), p317 = slice(), k318 = point(), a319 = list(), y320 = mark(), c321 = adder(), x322 = parsed();
  const b323 = box(), d324 = fraction(), s325 = narrow(), i326 = int(), e327 = either(), t328 = flag(), g329 = big(), l330 = large(), z331 = special(), w332 = wide(), r333 = rope(), p334 = slice(), k335 = point(), a336 = list(), y337 = mark(), c338 = adder(), x339 = parsed();
  const b340 = box(), d341 = fraction(), s342 = narrow(), i343 = int(), e344 = either(), t345 = flag(), g346 = big(), l347 = large(), z348 = special(), w349 = wide(), r350 = rope(), p351 = slice(), k352 = point(), a353 = list(), y354 = mark(), c355 = adder(), x356 = parsed();
  const b357 = box(), d358 = fraction(), s359 = narrow(), i360 = int(), e361 = either(), t362 = flag(), g363 = big(), l364 = large(), z365 = special(), w366 = wide(), r367 = rope(), p368 = slice(), k369 = point(), a370 = list(), y371 = mark(), c372 = adder(), x373 = parsed();
  const b374 = box(), d375 = fraction(), s376 = narrow(), i377 = int(), e378 = either(), t379 = flag(), g380 = big(), l381 = large(), z382 = special(), w383 = wide(), r384 = rope(), p385 = slice(), k386 = point(), a387 = list(), y388 = mark(), c389 = adder(), x390 = parsed();
  const b391 = box(), d392 = fraction(), s393 = narrow(), i394 = int(), e395 = either(), t396 = flag(), g397 = big(), l398 = large(), z399 = special(), w400 = wide(), r401 = rope(), p402 = slice(), k403 = point(), a404 = list(), y405 = mark(), c406 = adder(), x407 = parsed();
  const b408 = box(), d409 = fraction(), s410 = narrow(), i411 = int(), e412 = either(), t413 = flag(), g414 = big(), l415 = large(), z416 = special(), w417 = wide(), r418 = rope(), p419 = slice(), k420 = point(), a421 = list(), y422 = mark(), c423 = adder(), x424 = parsed();
  const b425 = box(), d426 = fraction(), s427 = narrow(), i428 = int(), e429 = either(), t430 = flag(), g431 = big(), l432 = large(), z433 = special(), w434 = wide(), r435 = rope(), p436 = slice(), k437 = point(), a438 = list(), y439 = mark(), c440 = adder(), x441 = parsed();
  const b442 = box(), d443 = fraction(), s444 = narrow(), i445 = int(), e446 = either(), t447 = flag(), g448 = big(), l449 = large(), z450 = special(), w451 = wide(), r452 = rope(), p453 = slice(), k454 = point(), a455 = list(), y456 = mark(), c457 = adder(), x458 = parsed();
  const b459 = box(), d460 = fraction(), s461 = narrow(), i462 = int(), e463 = either(), t464 = flag(), g465 = big(), l466 = large(), z467 = special(), w468 = wide(), r469 = rope(), p470 = slice(), k471 = point(), a472 = list(), y473 = mark(), c474 = adder(), x475 = parsed();
  const b476 = box(), d477 = fraction(), s478 = narrow(), i479 = int(), e480 = either(), t481 = flag(), g482 = big(), l483 = large(), z484 = special(), w485 = wide(), r486 = rope(), p487 = slice(), k488 = point(), a489 = list(), y490 = mark(), c491 = adder(), x492 = parsed();
  const b493 = box(), d494 = fraction(), s495 = narrow(), i496 = int(), e497 = either(), t498 = flag(), g499 = big(), l500 = large(), z501 = special(), w502 = wide(), r503 = rope(), p504 = slice(), k505 = point(), a506 = list(), y507 = mark(), c508 = adder(), x509 = parsed();
  const b510 = box(), d511 = fraction(), s512 = narrow(), i513 = int(), e514 = either(), t515 = flag(), g516 = big(), l517 = large(), z518 = special(), w519 = wide(), r520 = rope(), p521 = slice(), k522 = point(), a523 = list(), y524 = mark(), c525 = adder(), x526 = parsed();
  const b527 = box(), d528 = fraction(), s529 = narrow(), i530 = int(), e531 = either(), t532 = flag(), g533 = big(), l534 = large(), z535 = special(), w536 = wide(), r537 = rope(), p538 = slice(), k539 = point(), a540 = list(), y541 = mark(), c542 = adder(), x543 = parsed();
  const b544 = box(), d545 = fraction(), s546 = narrow(), i547 = int(), e548 = either(), t549 = flag(), g550 = big(), l551 = large(), z552 = special(), w553 = wide(), r554 = rope(), p555 = slice(), k556 = point(), a557 = list(), y558 = mark(), c559 = adder(), x560 = parsed();
  const b561 = box(), d562 = fraction(), s563 = narrow(), i564 = int(), e565 = either(), t566 = flag(), g567 = big(), l568 = large(), z569 = special(), w570 = wide(), r571 = rope(), p572 = slice(), k573 = point(), a574 = list(), y575 = mark(), c576 = adder(), x577 = parsed();
  const b578 = box(), d579 = fraction(), s580 = narrow(), i581 = int(), e582 = either(), t583 = flag(), g584 = big(), l585 = large(), z586 = special(), w587 = wide(), r588 = rope(), p589 = slice(), k590 = point(), a591 = list(), y592 = mark(), c593 = adder(), x594 = parsed();
  const b595 = box(), d596 = fraction(), s597 = narrow(), i598 = int(), e599 = either(), t600 = flag(), g601 = big(), l602 = large(), z603 = special(), w604 = wide(), r605 = rope(), p606 = slice(), k607 = point(), a608 = list(), y609 = mark(), c610 = adder(), x611 = parsed();
  const b612 = box(), d613 = fraction(), s614 = narrow(), i615 = int(), e616 = either(), t617 = flag(), g618 = big(), l619 = large(), z620 = special(), w621 = wide(), r622 = rope(), p623 = slice(), k624 = point(), a625 = list(), y626 = mark(), c627 = adder(), x628 = parsed();
  const b629 = box(), d630 = fraction(), s631 = narrow(), i632 = int(), e633 = either(), t634 = flag(), g635 = big(), l636 = large(), z637 = special(), w638 = wide(), r639 = rope(), p640 = slice(), k641 = point(), a642 = list(), y643 = mark(), c644 = adder(), x645 = parsed();
  const b646 = box(), d647 = fraction(), s648 = narrow(), i649 = int(), e650 = either(), t651 = flag(), g652 = big(), l653 = large(), z654 = special(), w655 = wide(), r656 = rope(), p657 = slice(), k658 = point(), a659 = list(), y660 = mark(), c661 = adder(), x662 = parsed();
  const b663 = box(), d664 = fraction(), s665 = narrow(), i666 = int(), e667 = either(), t668 = flag(), g669 = big(), l670 = large(), z671 = special(), w672 = wide(), r673 = rope(), p674 = slice(), k675 = point(), a676 = list(), y677 = mark(), c678 = adder(), x679 = parsed();
  const b680 = box(), d681 = fraction(), s682 = narrow(), i683 = int(), e684 = either(), t685 = flag(), g686 = big(), l687 = large(), z688 = special(), w689 = wide(), r690 = rope(), p691 = slice(), k692 = point(), a693 = list(), y694 = mark(), c695 = adder(), x696 = parsed();
  const b697 = box(), d698 = fraction(), s699 = narrow(), i700 = int(), e701 = either(), t702 = flag(), g703 = big(), l704 = large(), z705 = special(), w706 = wide(), r707 = rope(), p708 = slice(), k709 = point(), a710 = list(), y711 = mark(), c712 = adder(), x713 = parsed();
  const b714 = box(), d715 = fraction(), s716 = narrow(), i717 = int(), e718 = either(), t719 = flag(), g720 = big(), l721 = large(), z722 = special(), w723 = wide(), r724 = rope(), p725 = slice(), k726 = point(), a727 = list(), y728 = mark(), c729 = adder(), x730 = parsed();
  const b731 = box(), d732 = fraction(), s733 = narrow(), i734 = int(), e735 = either(), t736 = flag(), g737 = big(), l738 = large(), z739 = special(), w740 = wide(), r741 = rope(), p742 = slice(), k743 = point(), a744 = list(), y745 = mark(), c746 = adder(), x747 = parsed();
  const b748 = box(), d749 = fraction(), s750 = narrow(), i751 = int(), e752 = either(), t753 = flag(), g754 = big(), l755 = large(), z756 = special(), w757 = wide(), r758 = rope(), p759 = slice(), k760 = point(), a761 = list(), y762 = mark(), c763 = adder(), x764 = parsed();
  const b765 = box(), d766 = fraction(), s767 = narrow(), i768 = int(), e769 = either(), t770 = flag(), g771 = big(), l772 = large(), z773 = special(), w774 = wide(), r775 = rope(), p776 = slice(), k777 = point(), a778 = list(), y779 = mark(), c780 = adder(), x781 = parsed();
  const b782 = box(), d783 = fraction(), s784 = narrow(), i785 = int(), e786 = either(), t787 = flag(), g788 = big(), l789 = large(), z790 = special(), w791 = wide(), r792 = rope(), p793 = slice(), k794 = point(), a795 = list(), y796 = mark(), c797 = adder(), x798 = parsed();
  const b799 = box(), d800 = fraction(), s801 = narrow(), i802 = int(), e803 = either(), t804 = flag(), g805 = big(), l806 = large(), z807 = special(), w808 = wide(), r809 = rope(), p810 = slice(), k811 = point(), a812 = list(), y813 = mark(), c814 = adder(), x815 = parsed();
  const b816 = box(), d817 = fraction(), s818 = narrow(), i819 = int(), e820 = either(), t821 = flag(), g822 = big(), l823 = large(), z824 = special(), w825 = wide(), r826 = rope(), p827 = slice(), k828 = point(), a829 = list(), y830 = mark(), c831 = adder(), x832 = parsed();
  const b833 = box(), d834 = fraction(), s835 = narrow(), i836 = int(), e837 = either(), t838 = flag(), g839 = big(), l840 = large(), z841 = special(), w842 = wide(), r843 = rope(), p844 = slice(), k845 = point(), a846 = list(), y847 = mark(), c848 = adder(), x849 = parsed();
  const b850 = box(), d851 = fraction(), s852 = narrow(), i853 = int(), e854 = either(), t855 = flag(), g856 = big(), l857 = large(), z858 = special(), w859 = wide(), r860 = rope(), p861 = slice(), k862 = point(), a863 = list(), y864 = mark(), c865 = adder(), x866 = parsed();
  const b867 = box(), d868 = fraction(), s869 = narrow(), i870 = int(), e871 = either(), t872 = flag(), g873 = big(), l874 = large(), z875 = special(), w876 = wide(), r877 = rope(), p878 = slice(), k879 = point(), a880 = list(), y881 = mark(), c882 = adder(), x883 = parsed();
  const b884 = box(), d885 = fraction(), s886 = narrow(), i887 = int(), e888 = either(), t889 = flag(), g890 = big(), l891 = large(), z892 = special(), w893 = wide(), r894 = rope(), p895 = slice(), k896 = point(), a897 = list(), y898 = mark(), c899 = adder(), x900 = parsed();
  const b901 = box(), d902 = fraction(), s903 = narrow(), i904 = int(), e905 = either(), t906 = flag(), g907 = big(), l908 = large(), z909 = special(), w910 = wide(), r911 = rope(), p912 = slice(), k913 = point(), a914 = list(), y915 = mark(), c916 = adder(), x917 = parsed();
  const b918 = box(), d919 = fraction(), s920 = narrow(), i921 = int(), e922 = either(), t923 = flag(), g924 = big(), l925 = large(), z926 = special(), w927 = wide(), r928 = rope(), p929 = slice(), k930 = point(), a931 = list(), y932 = mark(), c933 = adder(), x934 = parsed();
  const b935 = box(), d936 = fraction(), s937 = narrow(), i938 = int(), e939 = either(), t940 = flag(), g941 = big(), l942 = large(), z943 = special(), w944 = wide(), r945 = rope(), p946 = slice(), k947 = point(), a948 = list(), y949 = mark(), c950 = adder(), x951 = parsed();
  const b952 = box(), d953 = fraction(), s954 = narrow(), i955 = int(), e956 = either(), t957 = flag(), g958 = big(), l959 = large(), z960 = special(), w961 = wide(), r962 = rope(), p963 = slice(), k964 = point(), a965 = list(), y966 = mark(), c967 = adder(), x968 = parsed();
  const b969 = box(), d970 = fraction(), s971 = narrow(), i972 = int(), e973 = either(), t974 = flag(), g975 = big(), l976 = large(), z977 = special(), w978 = wide(), r979 = rope(), p980 = slice(), k981 = point(), a982 = list(), y983 = mark(), c984 = adder(), x985 = parsed();
  const b986 = box(), d987 = fraction(), s988 = narrow(), i989 = int(), e990 = either(), t991 = flag(), g992 = big(), l993 = large(), z994 = special(), w995 = wide(), r996 = rope(), p997 = slice(), k998 = point(), a999 = list(), y1000 = mark(), c1001 = adder(), x1002 = parsed();
  const b1003 = box(), d1004 = fraction(), s1005 = narrow(), i1006 = int(), e1007 = either(), t1008 = flag(), g1009 = big(), l1010 = large(), z1011 = special(), w1012 = wide(), r1013 = rope(), p1014 = slice(), k1015 = point(), a1016 = list(), y1017 = mark(), c1018 = adder(), x1019 = parsed();
  const b1020 = box(), d1021 = fraction(), s1022 = narrow(), i1023 = int(), e1024 = either(), t1025 = flag(), g1026 = big(), l1027 = large(), z1028 = special(), w1029 = wide(), r1030 = rope(), p1031 = slice(), k1032 = point(), a1033 = list(), y1034 = mark(), c1035 = adder(), x1036 = parsed();
  const b1037 = box(), d1038 = fraction(), s1039 = narrow(), i1040 = int(), e1041 = either(), t1042 = flag(), g1043 = big(), l1044 = large(), z1045 = special(), w1046 = wide(), r1047 = rope(), p1048 = slice(), k1049 = point(), a1050 = list(), y1051 = mark(), c1052 = adder(), x1053 = parsed();
  const b1054 = box(), d1055 = fraction(), s1056 = narrow(), i1057 = int(), e1058 = either(), t1059 = flag(), g1060 = big(), l1061 = large(), z1062 = special(), w1063 = wide(), r1064 = rope(), p1065 = slice(), k1066 = point(), a1067 = list(), y1068 = mark(), c1069 = adder(), x1070 = parsed();
  const b1071 = box(), d1072 = fraction(), s1073 = narrow(), i1074 = int(), e1075 = either(), t1076 = flag(), g1077 = big(), l1078 = large(), z1079 = special(), w1080 = wide(), r1081 = rope(), p1082 = slice(), k1083 = point(), a1084 = list(), y1085 = mark(), c1086 = adder(), x1087 = parsed();
  const b1088 = box(), d1089 = fraction(), s1090 = narrow(), i1091 = int(), e1092 = either(), t1093 = flag(), g1094 = big(), l1095 = large(), z1096 = special(), w1097 = wide(), r1098 = rope(), p1099 = slice(), k1100 = point(), a1101 = list(), y1102 = mark(), c1103 = adder(), x1104 = parsed();
  const b1105 = box(), d1106 = fraction(), s1107 = narrow(), i1108 = int(), e1109 = either(), t1110 = flag(), g1111 = big(), l1112 = large(), z1113 = special(), w1114 = wide(), r1115 = rope(), p1116 = slice(), k1117 = point(), a1118 = list(), y1119 = mark(), c1120 = adder(), x1121 = parsed();
  const b1122 = box(), d1123 = fraction(), s1124 = narrow(), i1125 = int(), e1126 = either(), t1127 = flag(), g1128 = big(), l1129 = large(), z1130 = special(), w1131 = wide(), r1132 = rope(), p1133 = slice(), k1134 = point(), a1135 = list(), y1136 = mark(), c1137 = adder(), x1138 = parsed();
  const b1139 = box(), d1140 = fraction(), s1141 = narrow(), i1142 = int(), e1143 = either(), t1144 = flag(), g1145 = big(), l1146 = large(), z1147 = special(), w1148 = wide(), r1149 = rope(), p1150 = slice(), k1151 = point(), a1152 = list(), y1153 = mark(), c1154 = adder(), x1155 = parsed();
  const b1156 = box(), d1157 = fraction(), s1158 = narrow(), i1159 = int(), e1160 = either(), t1161 = flag(), g1162 = big(), l1163 = large(), z1164 = special(), w1165 = wide(), r1166 = rope(), p1167 = slice(), k1168 = point(), a1169 = list(), y1170 = mark(), c1171 = adder(), x1172 = parsed();
  const b1173 = box(), d1174 = fraction(), s1175 = narrow(), i1176 = int(), e1177 = either(), t1178 = flag(), g1179 = big(), l1180 = large(), z1181 = special(), w1182 = wide(), r1183 = rope(), p1184 = slice(), k1185 = point(), a1186 = list(), y1187 = mark(), c1188 = adder(), x1189 = parsed();
  const b1190 = box(), d1191 = fraction(), s1192 = narrow(), i1193 = int(), e1194 = either(), t1195 = flag(), g1196 = big(), l1197 = large(), z1198 = special(), w1199 = wide(), r1200 = rope(), p1201 = slice(), k1202 = point(), a1203 = list(), y1204 = mark(), c1205 = adder(), x1206 = parsed();
  const b1207 = box(), d1208 = fraction(), s1209 = narrow(), i1210 = int(), e1211 = either(), t1212 = flag(), g1213 = big(), l1214 = large(), z1215 = special(), w1216 = wide(), r1217 = rope(), p1218 = slice(), k1219 = point(), a1220 = list(), y1221 = mark(), c1222 = adder(), x1223 = parsed();
  const b1224 = box(), d1225 = fraction(), s1226 = narrow(), i1227 = int(), e1228 = either(), t1229 = flag(), g1230 = big(), l1231 = large(), z1232 = special(), w1233 = wide(), r1234 = rope(), p1235 = slice(), k1236 = point(), a1237 = list(), y1238 = mark(), c1239 = adder(), x1240 = parsed();
  const b1241 = box(), d1242 = fraction(), s1243 = narrow(), i1244 = int(), e1245 = either(), t1246 = flag(), g1247 = big(), l1248 = large(), z1249 = special(), w1250 = wide(), r1251 = rope(), p1252 = slice(), k1253 = point(), a1254 = list(), y1255 = mark(), c1256 = adder(), x1257 = parsed();
  const b1258 = box(), d1259 = fraction(), s1260 = narrow(), i1261 = int(), e1262 = either(), t1263 = flag(), g1264 = big(), l1265 = large(), z1266 = special(), w1267 = wide(), r1268 = rope(), p1269 = slice(), k1270 = point(), a1271 = list(), y1272 = mark(), c1273 = adder(), x1274 = parsed();
  const b1275 = box(), d1276 = fraction(), s1277 = narrow(), i1278 = int(), e1279 = either(), t1280 = flag(), g1281 = big(), l1282 = large(), z1283 = special(), w1284 = wide(), r1285 = rope(), p1286 = slice(), k1287 = point(), a1288 = list(), y1289 = mark(), c1290 = adder(), x1291 = parsed();
  const b1292 = box(), d1293 = fraction(), s1294 = narrow(), i1295 = int(), e1296 = either(), t1297 = flag(), g1298 = big(), l1299 = large(), z1300 = special(), w1301 = wide(), r1302 = rope(), p1303 = slice(), k1304 = point(), a1305 = list(), y1306 = mark(), c1307 = adder(), x1308 = parsed();
  const b1309 = box(), d1310 = fraction(), s1311 = narrow(), i1312 = int(), e1313 = either(), t1314 = flag(), g1315 = big(), l1316 = large(), z1317 = special(), w1318 = wide(), r1319 = rope(), p1320 = slice(), k1321 = point(), a1322 = list(), y1323 = mark(), c1324 = adder(), x1325 = parsed();
  const b1326 = box(), d1327 = fraction(), s1328 = narrow(), i1329 = int(), e1330 = either(), t1331 = flag(), g1332 = big(), l1333 = large(), z1334 = special(), w1335 = wide(), r1336 = rope(), p1337 = slice(), k1338 = point(), a1339 = list(), y1340 = mark(), c1341 = adder(), x1342 = parsed();
  const b1343 = box(), d1344 = fraction(), s1345 = narrow(), i1346 = int(), e1347 = either(), t1348 = flag(), g1349 = big(), l1350 = large(), z1351 = special(), w1352 = wide(), r1353 = rope(), p1354 = slice(), k1355 = point(), a1356 = list(), y1357 = mark(), c1358 = adder(), x1359 = parsed();
  const b1360 = box(), d1361 = fraction(), s1362 = narrow(), i1363 = int(), e1364 = either(), t1365 = flag(), g1366 = big(), l1367 = large(), z1368 = special(), w1369 = wide(), r1370 = rope(), p1371 = slice(), k1372 = point(), a1373 = list(), y1374 = mark(), c1375 = adder(), x1376 = parsed();
  const b1377 = box(), d1378 = fraction(), s1379 = narrow(), i1380 = int(), e1381 = either(), t1382 = flag(), g1383 = big(), l1384 = large(), z1385 = special(), w1386 = wide(), r1387 = rope(), p1388 = slice(), k1389 = point(), a1390 = list(), y1391 = mark(), c1392 = adder(), x1393 = parsed();
  const b1394 = box(), d1395 = fraction(), s1396 = narrow(), i1397 = int(), e1398 = either(), t1399 = flag(), g1400 = big(), l1401 = large(), z1402 = special(), w1403 = wide(), r1404 = rope(), p1405 = slice(), k1406 = point(), a1407 = list(), y1408 = mark(), c1409 = adder(), x1410 = parsed();
  const b1411 = box(), d1412 = fraction(), s1413 = narrow(), i1414 = int(), e1415 = either(), t1416 = flag(), g1417 = big(), l1418 = large(), z1419 = special(), w1420 = wide(), r1421 = rope(), p1422 = slice(), k1423 = point(), a1424 = list(), y1425 = mark(), c1426 = adder(), x1427 = parsed();
  const b1428 = box(), d1429 = fraction(), s1430 = narrow(), i1431 = int(), e1432 = either(), t1433 = flag(), g1434 = big(), l1435 = large(), z1436 = special(), w1437 = wide(), r1438 = rope(), p1439 = slice(), k1440 = point(), a1441 = list(), y1442 = mark(), c1443 = adder(), x1444 = parsed();
  const b1445 = box(), d1446 = fraction(), s1447 = narrow(), i1448 = int(), e1449 = either(), t1450 = flag(), g1451 = big(), l1452 = large(), z1453 = special(), w1454 = wide(), r1455 = rope(), p1456 = slice(), k1457 = point(), a1458 = list(), y1459 = mark(), c1460 = adder(), x1461 = parsed();
  const b1462 = box(), d1463 = fraction(), s1464 = narrow(), i1465 = int(), e1466 = either(), t1467 = flag(), g1468 = big(), l1469 = large(), z1470 = special(), w1471 = wide(), r1472 = rope(), p1473 = slice(), k1474 = point(), a1475 = list(), y1476 = mark(), c1477 = adder(), x1478 = parsed();
  const b1479 = box(), d1480 = fraction(), s1481 = narrow(), i1482 = int(), e1483 = either(), t1484 = flag(), g1485 = big(), l1486 = large(), z1487 = special(), w1488 = wide(), r1489 = rope(), p1490 = slice(), k1491 = point(), a1492 = list(), y1493 = mark(), c1494 = adder(), x1495 = parsed();
  const b1496 = box(), d1497 = fraction(), s1498 = narrow(), i1499 = int(), e1500 = either(), t1501 = flag(), g1502 = big(), l1503 = large(), z1504 = special(), w1505 = wide(), r1506 = rope(), p1507 = slice(), k1508 = point(), a1509 = list(), y1510 = mark(), c1511 = adder(), x1512 = parsed();
  const b1513 = box(), d1514 = fraction(), s1515 = narrow(), i1516 = int(), e1517 = either(), t1518 = flag(), g1519 = big(), l1520 = large(), z1521 = special(), w1522 = wide(), r1523 = rope(), p1524 = slice(), k1525 = point(), a1526 = list(), y1527 = mark(), c1528 = adder(), x1529 = parsed();
  const b1530 = box(), d1531 = fraction(), s1532 = narrow(), i1533 = int(), e1534 = either(), t1535 = flag(), g1536 = big(), l1537 = large(), z1538 = special(), w1539 = wide(), r1540 = rope(), p1541 = slice(), k1542 = point(), a1543 = list(), y1544 = mark(), c1545 = adder(), x1546 = parsed();
  const b1547 = box(), d1548 = fraction(), s1549 = narrow(), i1550 = int(), e1551 = either(), t1552 = flag(), g1553 = big(), l1554 = large(), z1555 = special(), w1556 = wide(), r1557 = rope(), p1558 = slice(), k1559 = point(), a1560 = list(), y1561 = mark(), c1562 = adder(), x1563 = parsed();
  const b1564 = box(), d1565 = fraction(), s1566 = narrow(), i1567 = int(), e1568 = either(), t1569 = flag(), g1570 = big(), l1571 = large(), z1572 = special(), w1573 = wide(), r1574 = rope(), p1575 = slice(), k1576 = point(), a1577 = list(), y1578 = mark(), c1579 = adder(), x1580 = parsed();
  const b1581 = box(), d1582 = fraction(), s1583 = narrow(), i1584 = int(), e1585 = either(), t1586 = flag(), g1587 = big(), l1588 = large(), z1589 = special(), w1590 = wide(), r1591 = rope(), p1592 = slice(), k1593 = point(), a1594 = list(), y1595 = mark(), c1596 = adder(), x1597 = parsed();
  const b1598 = box(), d1599 = fraction(), s1600 = narrow(), i1601 = int(), e1602 = either(), t1603 = flag(), g1604 = big(), l1605 = large(), z1606 = special(), w1607 = wide(), r1608 = rope(), p1609 = slice(), k1610 = point(), a1611 = list(), y1612 = mark(), c1613 = adder(), x1614 = parsed();
  const b1615 = box(), d1616 = fraction(), s1617 = narrow(), i1618 = int(), e1619 = either(), t1620 = flag(), g1621 = big(), l1622 = large(), z1623 = special(), w1624 = wide(), r1625 = rope(), p1626 = slice(), k1627 = point(), a1628 = list(), y1629 = mark(), c1630 = adder(), x1631 = parsed();
  const b1632 = box(), d1633 = fraction(), s1634 = narrow(), i1635 = int(), e1636 = either(), t1637 = flag(), g1638 = big(), l1639 = large(), z1640 = special(), w1641 = wide(), r1642 = rope(), p1643 = slice(), k1644 = point(), a1645 = list(), y1646 = mark(), c1647 = adder(), x1648 = parsed();
  const b1649 = box(), d1650 = fraction(), s1651 = narrow(), i1652 = int(), e1653 = either(), t1654 = flag(), g1655 = big(), l1656 = large(), z1657 = special(), w1658 = wide(), r1659 = rope(), p1660 = slice(), k1661 = point(), a1662 = list(), y1663 = mark(), c1664 = adder(), x1665 = parsed();
  const b1666 = box(), d1667 = fraction(), s1668 = narrow(), i1669 = int(), e1670 = either(), t1671 = flag(), g1672 = big(), l1673 = large(), z1674 = special(), w1675 = wide(), r1676 = rope(), p1677 = slice(), k1678 = point(), a1679 = list(), y1680 = mark(), c1681 = adder(), x1682 = parsed();
  const b1683 = box(), d1684 = fraction(), s1685 = narrow(), i1686 = int(), e1687 = either(), t1688 = flag(), g1689 = big(), l1690 = large(), z1691 = special(), w1692 = wide(), r1693 = rope(), p1694 = slice(), k1695 = point(), a1696 = list(), y1697 = mark(), c1698 = adder(), x1699 = parsed();
  const b1700 = box(), d1701 = fraction(), s1702 = narrow(), i1703 = int(), e1704 = either(), t1705 = flag(), g1706 = big(), l1707 = large(), z1708 = special(), w1709 = wide(), r1710 = rope(), p1711 = slice(), k1712 = point(), a1713 = list(), y1714 = mark(), c1715 = adder(), x1716 = parsed();
  const b1717 = box(), d1718 = fraction(), s1719 = narrow(), i1720 = int(), e1721 = either(), t1722 = flag(), g1723 = big(), l1724 = large(), z1725 = special(), w1726 = wide(), r1727 = rope(), p1728 = slice(), k1729 = point(), a1730 = list(), y1731 = mark(), c1732 = adder(), x1733 = parsed();
  const b1734 = box(), d1735 = fraction(), s1736 = narrow(), i1737 = int(), e1738 = either(), t1739 = flag(), g1740 = big(), l1741 = large(), z1742 = special(), w1743 = wide(), r1744 = rope(), p1745 = slice(), k1746 = point(), a1747 = list(), y1748 = mark(), c1749 = adder(), x1750 = parsed();
  const b1751 = box(), d1752 = fraction(), s1753 = narrow(), i1754 = int(), e1755 = either(), t1756 = flag(), g1757 = big(), l1758 = large(), z1759 = special(), w1760 = wide(), r1761 = rope(), p1762 = slice(), k1763 = point(), a1764 = list(), y1765 = mark(), c1766 = adder(), x1767 = parsed();
  const b1768 = box(), d1769 = fraction(), s1770 = narrow(), i1771 = int(), e1772 = either(), t1773 = flag(), g1774 = big(), l1775 = large(), z1776 = special(), w1777 = wide(), r1778 = rope(), p1779 = slice(), k1780 = point(), a1781 = list(), y1782 = mark(), c1783 = adder(), x1784 = parsed();
  const b1785 = box(), d1786 = fraction(), s1787 = narrow(), i1788 = int(), e1789 = either(), t1790 = flag(), g1791 = big(), l1792 = large(), z1793 = special(), w1794 = wide(), r1795 = rope(), p1796 = slice(), k1797 = point(), a1798 = list(), y1799 = mark(), c1800 = adder(), x1801 = parsed();
  const b1802 = box(), d1803 = fraction(), s1804 = narrow(), i1805 = int(), e1806 = either(), t1807 = flag(), g1808 = big(), l1809 = large(), z1810 = special(), w1811 = wide(), r1812 = rope(), p1813 = slice(), k1814 = point(), a1815 = list(), y1816 = mark(), c1817 = adder(), x1818 = parsed();
  const b1819 = box(), d1820 = fraction(), s1821 = narrow(), i1822 = int(), e1823 = either(), t1824 = flag(), g1825 = big(), l1826 = large(), z1827 = special(), w1828 = wide(), r1829 = rope(), p1830 = slice(), k1831 = point(), a1832 = list(), y1833 = mark(), c1834 = adder(), x1835 = parsed();
  const b1836 = box(), d1837 = fraction(), s1838 = narrow(), i1839 = int(), e1840 = either(), t1841 = flag(), g1842 = big(), l1843 = large(), z1844 = special(), w1845 = wide(), r1846 = rope(), p1847 = slice(), k1848 = point(), a1849 = list(), y1850 = mark(), c1851 = adder(), x1852 = parsed();
  const b1853 = box(), d1854 = fraction(), s1855 = narrow(), i1856 = int(), e1857 = either(), t1858 = flag(), g1859 = big(), l1860 = large(), z1861 = special(), w1862 = wide(), r1863 = rope(), p1864 = slice(), k1865 = point(), a1866 = list(), y1867 = mark(), c1868 = adder(), x1869 = parsed();
  const b1870 = box(), d1871 = fraction(), s1872 = narrow(), i1873 = int(), e1874 = either(), t1875 = flag(), g1876 = big(), l1877 = large(), z1878 = special(), w1879 = wide(), r1880 = rope(), p1881 = slice(), k1882 = point(), a1883 = list(), y1884 = mark(), c1885 = adder(), x1886 = parsed();
  const b1887 = box(), d1888 = fraction(), s1889 = narrow(), i1890 = int(), e1891 = either(), t1892 = flag(), g1893 = big(), l1894 = large(), z1895 = special(), w1896 = wide(), r1897 = rope(), p1898 = slice(), k1899 = point(), a1900 = list(), y1901 = mark(), c1902 = adder(), x1903 = parsed();
  const b1904 = box(), d1905 = fraction(), s1906 = narrow(), i1907 = int(), e1908 = either(), t1909 = flag(), g1910 = big(), l1911 = large(), z1912 = special(), w1913 = wide(), r1914 = rope(), p1915 = slice(), k1916 = point(), a1917 = list(), y1918 = mark(), c1919 = adder(), x1920 = parsed();
  const b1921 = box(), d1922 = fraction(), s1923 = narrow(), i1924 = int(), e1925 = either(), t1926 = flag(), g1927 = big(), l1928 = large(), z1929 = special(), w1930 = wide(), r1931 = rope(), p1932 = slice(), k1933 = point(), a1934 = list(), y1935 = mark(), c1936 = adder(), x1937 = parsed();
  const b1938 = box(), d1939 = fraction(), s1940 = narrow(), i1941 = int(), e1942 = either(), t1943 = flag(), g1944 = big(), l1945 = large(), z1946 = special(), w1947 = wide(), r1948 = rope(), p1949 = slice(), k1950 = point(), a1951 = list(), y1952 = mark(), c1953 = adder(), x1954 = parsed();
  const b1955 = box(), d1956 = fraction(), s1957 = narrow(), i1958 = int(), e1959 = either(), t1960 = flag(), g1961 = big(), l1962 = large(), z1963 = special(), w1964 = wide(), r1965 = rope(), p1966 = slice(), k1967 = point(), a1968 = list(), y1969 = mark(), c1970 = adder(), x1971 = parsed();
  const b1972 = box(), d1973 = fraction(), s1974 = narrow(), i1975 = int(), e1976 = either(), t1977 = flag(), g1978 = big(), l1979 = large(), z1980 = special(), w1981 = wide(), r1982 = rope(), p1983 = slice(), k1984 = point(), a1985 = list(), y1986 = mark(), c1987 = adder(), x1988 = parsed();
  const b1989 = box(), d1990 = fraction(), s1991 = narrow(), i1992 = int(), e1993 = either(), t1994 = flag(), g1995 = big(), l1996 = large(), z1997 = special(), w1998 = wide(), r1999 = rope();
  let h = await gate;
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = fold(h, b289, d290, s291, i292, e293, t294, g295, l296, z297, w298, r299, p300, k301, a302, y303, c304, x305);
  h = fold(h, b306, d307, s308, i309, e310, t311, g312, l313, z314, w315, r316, p317, k318, a319, y320, c321, x322);
  h = fold(h, b323, d324, s325, i326, e327, t328, g329, l330, z331, w332, r333, p334, k335, a336, y337, c338, x339);
  h = fold(h, b340, d341, s342, i343, e344, t345, g346, l347, z348, w349, r350, p351, k352, a353, y354, c355, x356);
  h = fold(h, b357, d358, s359, i360, e361, t362, g363, l364, z365, w366, r367, p368, k369, a370, y371, c372, x373);
  h = fold(h, b374, d375, s376, i377, e378, t379, g380, l381, z382, w383, r384, p385, k386, a387, y388, c389, x390);
  h = fold(h, b391, d392, s393, i394, e395, t396, g397, l398, z399, w400, r401, p402, k403, a404, y405, c406, x407);
  h = fold(h, b408, d409, s410, i411, e412, t413, g414, l415, z416, w417, r418, p419, k420, a421, y422, c423, x424);
  h = fold(h, b425, d426, s427, i428, e429, t430, g431, l432, z433, w434, r435, p436, k437, a438, y439, c440, x441);
  h = fold(h, b442, d443, s444, i445, e446, t447, g448, l449, z450, w451, r452, p453, k454, a455, y456, c457, x458);
  h = fold(h, b459, d460, s461, i462, e463, t464, g465, l466, z467, w468, r469, p470, k471, a472, y473, c474, x475);
  h = fold(h, b476, d477, s478, i479, e480, t481, g482, l483, z484, w485, r486, p487, k488, a489, y490, c491, x492);
  h = fold(h, b493, d494, s495, i496, e497, t498, g499, l500, z501, w502, r503, p504, k505, a506, y507, c508, x509);
  h = fold(h, b510, d511, s512, i513, e514, t515, g516, l517, z518, w519, r520, p521, k522, a523, y524, c525, x526);
  h = fold(h, b527, d528, s529, i530, e531, t532, g533, l534, z535, w536, r537, p538, k539, a540, y541, c542, x543);
  h = fold(h, b544, d545, s546, i547, e548, t549, g550, l551, z552, w553, r554, p555, k556, a557, y558, c559, x560);
  h = fold(h, b561, d562, s563, i564, e565, t566, g567, l568, z569, w570, r571, p572, k573, a574, y575, c576, x577);
  h = fold(h, b578, d579, s580, i581, e582, t583, g584, l585, z586, w587, r588, p589, k590, a591, y592, c593, x594);
  h = fold(h, b595, d596, s597, i598, e599, t600, g601, l602, z603, w604, r605, p606, k607, a608, y609, c610, x611);
  h = fold(h, b612, d613, s614, i615, e616, t617, g618, l619, z620, w621, r622, p623, k624, a625, y626, c627, x628);
  h = fold(h, b629, d630, s631, i632, e633, t634, g635, l636, z637, w638, r639, p640, k641, a642, y643, c644, x645);
  h = fold(h, b646, d647, s648, i649, e650, t651, g652, l653, z654, w655, r656, p657, k658, a659, y660, c661, x662);
  h = fold(h, b663, d664, s665, i666, e667, t668, g669, l670, z671, w672, r673, p674, k675, a676, y677, c678, x679);
  h = fold(h, b680, d681, s682, i683, e684, t685, g686, l687, z688, w689, r690, p691, k692, a693, y694, c695, x696);
  h = fold(h, b697, d698, s699, i700, e701, t702, g703, l704, z705, w706, r707, p708, k709, a710, y711, c712, x713);
  h = fold(h, b714, d715, s716, i717, e718, t719, g720, l721, z722, w723, r724, p725, k726, a727, y728, c729, x730);
  h = fold(h, b731, d732, s733, i734, e735, t736, g737, l738, z739, w740, r741, p742, k743, a744, y745, c746, x747);
  h = fold(h, b748, d749, s750, i751, e752, t753, g754, l755, z756, w757, r758, p759, k760, a761, y762, c763, x764);
  h = fold(h, b765, d766, s767, i768, e769, t770, g771, l772, z773, w774, r775, p776, k777, a778, y779, c780, x781);
  h = fold(h, b782, d783, s784, i785, e786, t787, g788, l789, z790, w791, r792, p793, k794, a795, y796, c797, x798);
  h = fold(h, b799, d800, s801, i802, e803, t804, g805, l806, z807, w808, r809, p810, k811, a812, y813, c814, x815);
  h = fold(h, b816, d817, s818, i819, e820, t821, g822, l823, z824, w825, r826, p827, k828, a829, y830, c831, x832);
  h = fold(h, b833, d834, s835, i836, e837, t838, g839, l840, z841, w842, r843, p844, k845, a846, y847, c848, x849);
  h = fold(h, b850, d851, s852, i853, e854, t855, g856, l857, z858, w859, r860, p861, k862, a863, y864, c865, x866);
  h = fold(h, b867, d868, s869, i870, e871, t872, g873, l874, z875, w876, r877, p878, k879, a880, y881, c882, x883);
  h = fold(h, b884, d885, s886, i887, e888, t889, g890, l891, z892, w893, r894, p895, k896, a897, y898, c899, x900);
  h = fold(h, b901, d902, s903, i904, e905, t906, g907, l908, z909, w910, r911, p912, k913, a914, y915, c916, x917);
  h = fold(h, b918, d919, s920, i921, e922, t923, g924, l925, z926, w927, r928, p929, k930, a931, y932, c933, x934);
  h = fold(h, b935, d936, s937, i938, e939, t940, g941, l942, z943, w944, r945, p946, k947, a948, y949, c950, x951);
  h = fold(h, b952, d953, s954, i955, e956, t957, g958, l959, z960, w961, r962, p963, k964, a965, y966, c967, x968);
  h = fold(h, b969, d970, s971, i972, e973, t974, g975, l976, z977, w978, r979, p980, k981, a982, y983, c984, x985);
  h = fold(h, b986, d987, s988, i989, e990, t991, g992, l993, z994, w995, r996, p997, k998, a999, y1000, c1001, x1002);
  h = fold(h, b1003, d1004, s1005, i1006, e1007, t1008, g1009, l1010, z1011, w1012, r1013, p1014, k1015, a1016, y1017, c1018, x1019);
  h = fold(h, b1020, d1021, s1022, i1023, e1024, t1025, g1026, l1027, z1028, w1029, r1030, p1031, k1032, a1033, y1034, c1035, x1036);
  h = fold(h, b1037, d1038, s1039, i1040, e1041, t1042, g1043, l1044, z1045, w1046, r1047, p1048, k1049, a1050, y1051, c1052, x1053);
  h = fold(h, b1054, d1055, s1056, i1057, e1058, t1059, g1060, l1061, z1062, w1063, r1064, p1065, k1066, a1067, y1068, c1069, x1070);
  h = fold(h, b1071, d1072, s1073, i1074, e1075, t1076, g1077, l1078, z1079, w1080, r1081, p1082, k1083, a1084, y1085, c1086, x1087);
  h = fold(h, b1088, d1089, s1090, i1091, e1092, t1093, g1094, l1095, z1096, w1097, r1098, p1099, k1100, a1101, y1102, c1103, x1104);
  h = fold(h, b1105, d1106, s1107, i1108, e1109, t1110, g1111, l1112, z1113, w1114, r1115, p1116, k1117, a1118, y1119, c1120, x1121);
  h = fold(h, b1122, d1123, s1124, i1125, e1126, t1127, g1128, l1129, z1130, w1131, r1132, p1133, k1134, a1135, y1136, c1137, x1138);
  h = fold(h, b1139, d1140, s1141, i1142, e1143, t1144, g1145, l1146, z1147, w1148, r1149, p1150, k1151, a1152, y1153, c1154, x1155);
  h = fold(h, b1156, d1157, s1158, i1159, e1160, t1161, g1162, l1163, z1164, w1165, r1166, p1167, k1168, a1169, y1170, c1171, x1172);
  h = fold(h, b1173, d1174, s1175, i1176, e1177, t1178, g1179, l1180, z1181, w1182, r1183, p1184, k1185, a1186, y1187, c1188, x1189);
  h = fold(h, b1190, d1191, s1192, i1193, e1194, t1195, g1196, l1197, z1198, w1199, r1200, p1201, k1202, a1203, y1204, c1205, x1206);
  h = fold(h, b1207, d1208, s1209, i1210, e1211, t1212, g1213, l1214, z1215, w1216, r1217, p1218, k1219, a1220, y1221, c1222, x1223);
  h = fold(h, b1224, d1225, s1226, i1227, e1228, t1229, g1230, l1231, z1232, w1233, r1234, p1235, k1236, a1237, y1238, c1239, x1240);
  h = fold(h, b1241, d1242, s1243, i1244, e1245, t1246, g1247, l1248, z1249, w1250, r1251, p1252, k1253, a1254, y1255, c1256, x1257);
  h = fold(h, b1258, d1259, s1260, i1261, e1262, t1263, g1264, l1265, z1266, w1267, r1268, p1269, k1270, a1271, y1272, c1273, x1274);
  h = fold(h, b1275, d1276, s1277, i1278, e1279, t1280, g1281, l1282, z1283, w1284, r1285, p1286, k1287, a1288, y1289, c1290, x1291);
  h = fold(h, b1292, d1293, s1294, i1295, e1296, t1297, g1298, l1299, z1300, w1301, r1302, p1303, k1304, a1305, y1306, c1307, x1308);
  h = fold(h, b1309, d1310, s1311, i1312, e1313, t1314, g1315, l1316, z1317, w1318, r1319, p1320, k1321, a1322, y1323, c1324, x1325);
  h = fold(h, b1326, d1327, s1328, i1329, e1330, t1331, g1332, l1333, z1334, w1335, r1336, p1337, k1338, a1339, y1340, c1341, x1342);
  h = fold(h, b1343, d1344, s1345, i1346, e1347, t1348, g1349, l1350, z1351, w1352, r1353, p1354, k1355, a1356, y1357, c1358, x1359);
  h = fold(h, b1360, d1361, s1362, i1363, e1364, t1365, g1366, l1367, z1368, w1369, r1370, p1371, k1372, a1373, y1374, c1375, x1376);
  h = fold(h, b1377, d1378, s1379, i1380, e1381, t1382, g1383, l1384, z1385, w1386, r1387, p1388, k1389, a1390, y1391, c1392, x1393);
  h = fold(h, b1394, d1395, s1396, i1397, e1398, t1399, g1400, l1401, z1402, w1403, r1404, p1405, k1406, a1407, y1408, c1409, x1410);
  h = fold(h, b1411, d1412, s1413, i1414, e1415, t1416, g1417, l1418, z1419, w1420, r1421, p1422, k1423, a1424, y1425, c1426, x1427);
  h = fold(h, b1428, d1429, s1430, i1431, e1432, t1433, g1434, l1435, z1436, w1437, r1438, p1439, k1440, a1441, y1442, c1443, x1444);
  h = fold(h, b1445, d1446, s1447, i1448, e1449, t1450, g1451, l1452, z1453, w1454, r1455, p1456, k1457, a1458, y1459, c1460, x1461);
  h = fold(h, b1462, d1463, s1464, i1465, e1466, t1467, g1468, l1469, z1470, w1471, r1472, p1473, k1474, a1475, y1476, c1477, x1478);
  h = fold(h, b1479, d1480, s1481, i1482, e1483, t1484, g1485, l1486, z1487, w1488, r1489, p1490, k1491, a1492, y1493, c1494, x1495);
  h = fold(h, b1496, d1497, s1498, i1499, e1500, t1501, g1502, l1503, z1504, w1505, r1506, p1507, k1508, a1509, y1510, c1511, x1512);
  h = fold(h, b1513, d1514, s1515, i1516, e1517, t1518, g1519, l1520, z1521, w1522, r1523, p1524, k1525, a1526, y1527, c1528, x1529);
  h = fold(h, b1530, d1531, s1532, i1533, e1534, t1535, g1536, l1537, z1538, w1539, r1540, p1541, k1542, a1543, y1544, c1545, x1546);
  h = fold(h, b1547, d1548, s1549, i1550, e1551, t1552, g1553, l1554, z1555, w1556, r1557, p1558, k1559, a1560, y1561, c1562, x1563);
  h = fold(h, b1564, d1565, s1566, i1567, e1568, t1569, g1570, l1571, z1572, w1573, r1574, p1575, k1576, a1577, y1578, c1579, x1580);
  h = fold(h, b1581, d1582, s1583, i1584, e1585, t1586, g1587, l1588, z1589, w1590, r1591, p1592, k1593, a1594, y1595, c1596, x1597);
  h = fold(h, b1598, d1599, s1600, i1601, e1602, t1603, g1604, l1605, z1606, w1607, r1608, p1609, k1610, a1611, y1612, c1613, x1614);
  h = fold(h, b1615, d1616, s1617, i1618, e1619, t1620, g1621, l1622, z1623, w1624, r1625, p1626, k1627, a1628, y1629, c1630, x1631);
  h = fold(h, b1632, d1633, s1634, i1635, e1636, t1637, g1638, l1639, z1640, w1641, r1642, p1643, k1644, a1645, y1646, c1647, x1648);
  h = fold(h, b1649, d1650, s1651, i1652, e1653, t1654, g1655, l1656, z1657, w1658, r1659, p1660, k1661, a1662, y1663, c1664, x1665);
  h = fold(h, b1666, d1667, s1668, i1669, e1670, t1671, g1672, l1673, z1674, w1675, r1676, p1677, k1678, a1679, y1680, c1681, x1682);
  h = fold(h, b1683, d1684, s1685, i1686, e1687, t1688, g1689, l1690, z1691, w1692, r1693, p1694, k1695, a1696, y1697, c1698, x1699);
  h = fold(h, b1700, d1701, s1702, i1703, e1704, t1705, g1706, l1707, z1708, w1709, r1710, p1711, k1712, a1713, y1714, c1715, x1716);
  h = fold(h, b1717, d1718, s1719, i1720, e1721, t1722, g1723, l1724, z1725, w1726, r1727, p1728, k1729, a1730, y1731, c1732, x1733);
  h = fold(h, b1734, d1735, s1736, i1737, e1738, t1739, g1740, l1741, z1742, w1743, r1744, p1745, k1746, a1747, y1748, c1749, x1750);
  h = fold(h, b1751, d1752, s1753, i1754, e1755, t1756, g1757, l1758, z1759, w1760, r1761, p1762, k1763, a1764, y1765, c1766, x1767);
  h = fold(h, b1768, d1769, s1770, i1771, e1772, t1773, g1774, l1775, z1776, w1777, r1778, p1779, k1780, a1781, y1782, c1783, x1784);
  h = fold(h, b1785, d1786, s1787, i1788, e1789, t1790, g1791, l1792, z1793, w1794, r1795, p1796, k1797, a1798, y1799, c1800, x1801);
  h = fold(h, b1802, d1803, s1804, i1805, e1806, t1807, g1808, l1809, z1810, w1811, r1812, p1813, k1814, a1815, y1816, c1817, x1818);
  h = fold(h, b1819, d1820, s1821, i1822, e1823, t1824, g1825, l1826, z1827, w1828, r1829, p1830, k1831, a1832, y1833, c1834, x1835);
  h = fold(h, b1836, d1837, s1838, i1839, e1840, t1841, g1842, l1843, z1844, w1845, r1846, p1847, k1848, a1849, y1850, c1851, x1852);
  h = fold(h, b1853, d1854, s1855, i1856, e1857, t1858, g1859, l1860, z1861, w1862, r1863, p1864, k1865, a1866, y1867, c1868, x1869);
  h = fold(h, b1870, d1871, s1872, i1873, e1874, t1875, g1876, l1877, z1878, w1879, r1880, p1881, k1882, a1883, y1884, c1885, x1886);
  h = fold(h, b1887, d1888, s1889, i1890, e1891, t1892, g1893, l1894, z1895, w1896, r1897, p1898, k1899, a1900, y1901, c1902, x1903);
  h = fold(h, b1904, d1905, s1906, i1907, e1908, t1909, g1910, l1911, z1912, w1913, r1914, p1915, k1916, a1917, y1918, c1919, x1920);
  h = fold(h, b1921, d1922, s1923, i1924, e1925, t1926, g1927, l1928, z1929, w1930, r1931, p1932, k1933, a1934, y1935, c1936, x1937);
  h = fold(h, b1938, d1939, s1940, i1941, e1942, t1943, g1944, l1945, z1946, w1947, r1948, p1949, k1950, a1951, y1952, c1953, x1954);
  h = fold(h, b1955, d1956, s1957, i1958, e1959, t1960, g1961, l1962, z1963, w1964, r1965, p1966, k1967, a1968, y1969, c1970, x1971);
  h = fold(h, b1972, d1973, s1974, i1975, e1976, t1977, g1978, l1979, z1980, w1981, r1982, p1983, k1984, a1985, y1986, c1987, x1988);
  h = ofBox(h, b1989); h = ofNumber(h, d1990); h = ofText(h, s1991); h = ofNumber(h, i1992); h = ofEither(h, e1993); h = ofFlag(h, t1994); h = ofBig(h, g1995); h = ofNumber(h, l1996); h = ofNumber(h, z1997); h = ofText(h, w1998); h = ofText(h, r1999);
  return h;
}

async function relays0(gate: Promise<number>, collects: boolean): Promise<number> {
  return (await awaits0(gate, collects)) + 1;
}
async function relays1(gate: Promise<number>, collects: boolean): Promise<number> {
  return (await awaits1(gate, collects)) + 1;
}
async function relays7(gate: Promise<number>, collects: boolean): Promise<number> {
  return (await awaits7(gate, collects)) + 1;
}
async function relays40(gate: Promise<number>, collects: boolean): Promise<number> {
  return (await awaits40(gate, collects)) + 1;
}
async function relays300(gate: Promise<number>, collects: boolean): Promise<number> {
  return (await awaits300(gate, collects)) + 1;
}
async function relays2000(gate: Promise<number>, collects: boolean): Promise<number> {
  return (await awaits2000(gate, collects)) + 1;
}

async function awaitsCall0(gate: Promise<number>, collects: boolean): Promise<number> {
  let h = await waitsFor(gate);
  if (collects) collect();
  return h;
}
async function awaitsCall1(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box();
  let h = await waitsFor(gate);
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
async function awaitsCall7(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = await waitsFor(gate);
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function awaitsCall40(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = await waitsFor(gate);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}
async function awaitsCall300(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope();
  let h = await waitsFor(gate);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = ofBox(h, b289); h = ofNumber(h, d290); h = ofText(h, s291); h = ofNumber(h, i292); h = ofEither(h, e293); h = ofFlag(h, t294); h = ofBig(h, g295); h = ofNumber(h, l296); h = ofNumber(h, z297); h = ofText(h, w298); h = ofText(h, r299);
  return h;
}
async function awaitsCall2000(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope(), p300 = slice(), k301 = point(), a302 = list(), y303 = mark(), c304 = adder(), x305 = parsed();
  const b306 = box(), d307 = fraction(), s308 = narrow(), i309 = int(), e310 = either(), t311 = flag(), g312 = big(), l313 = large(), z314 = special(), w315 = wide(), r316 = rope(), p317 = slice(), k318 = point(), a319 = list(), y320 = mark(), c321 = adder(), x322 = parsed();
  const b323 = box(), d324 = fraction(), s325 = narrow(), i326 = int(), e327 = either(), t328 = flag(), g329 = big(), l330 = large(), z331 = special(), w332 = wide(), r333 = rope(), p334 = slice(), k335 = point(), a336 = list(), y337 = mark(), c338 = adder(), x339 = parsed();
  const b340 = box(), d341 = fraction(), s342 = narrow(), i343 = int(), e344 = either(), t345 = flag(), g346 = big(), l347 = large(), z348 = special(), w349 = wide(), r350 = rope(), p351 = slice(), k352 = point(), a353 = list(), y354 = mark(), c355 = adder(), x356 = parsed();
  const b357 = box(), d358 = fraction(), s359 = narrow(), i360 = int(), e361 = either(), t362 = flag(), g363 = big(), l364 = large(), z365 = special(), w366 = wide(), r367 = rope(), p368 = slice(), k369 = point(), a370 = list(), y371 = mark(), c372 = adder(), x373 = parsed();
  const b374 = box(), d375 = fraction(), s376 = narrow(), i377 = int(), e378 = either(), t379 = flag(), g380 = big(), l381 = large(), z382 = special(), w383 = wide(), r384 = rope(), p385 = slice(), k386 = point(), a387 = list(), y388 = mark(), c389 = adder(), x390 = parsed();
  const b391 = box(), d392 = fraction(), s393 = narrow(), i394 = int(), e395 = either(), t396 = flag(), g397 = big(), l398 = large(), z399 = special(), w400 = wide(), r401 = rope(), p402 = slice(), k403 = point(), a404 = list(), y405 = mark(), c406 = adder(), x407 = parsed();
  const b408 = box(), d409 = fraction(), s410 = narrow(), i411 = int(), e412 = either(), t413 = flag(), g414 = big(), l415 = large(), z416 = special(), w417 = wide(), r418 = rope(), p419 = slice(), k420 = point(), a421 = list(), y422 = mark(), c423 = adder(), x424 = parsed();
  const b425 = box(), d426 = fraction(), s427 = narrow(), i428 = int(), e429 = either(), t430 = flag(), g431 = big(), l432 = large(), z433 = special(), w434 = wide(), r435 = rope(), p436 = slice(), k437 = point(), a438 = list(), y439 = mark(), c440 = adder(), x441 = parsed();
  const b442 = box(), d443 = fraction(), s444 = narrow(), i445 = int(), e446 = either(), t447 = flag(), g448 = big(), l449 = large(), z450 = special(), w451 = wide(), r452 = rope(), p453 = slice(), k454 = point(), a455 = list(), y456 = mark(), c457 = adder(), x458 = parsed();
  const b459 = box(), d460 = fraction(), s461 = narrow(), i462 = int(), e463 = either(), t464 = flag(), g465 = big(), l466 = large(), z467 = special(), w468 = wide(), r469 = rope(), p470 = slice(), k471 = point(), a472 = list(), y473 = mark(), c474 = adder(), x475 = parsed();
  const b476 = box(), d477 = fraction(), s478 = narrow(), i479 = int(), e480 = either(), t481 = flag(), g482 = big(), l483 = large(), z484 = special(), w485 = wide(), r486 = rope(), p487 = slice(), k488 = point(), a489 = list(), y490 = mark(), c491 = adder(), x492 = parsed();
  const b493 = box(), d494 = fraction(), s495 = narrow(), i496 = int(), e497 = either(), t498 = flag(), g499 = big(), l500 = large(), z501 = special(), w502 = wide(), r503 = rope(), p504 = slice(), k505 = point(), a506 = list(), y507 = mark(), c508 = adder(), x509 = parsed();
  const b510 = box(), d511 = fraction(), s512 = narrow(), i513 = int(), e514 = either(), t515 = flag(), g516 = big(), l517 = large(), z518 = special(), w519 = wide(), r520 = rope(), p521 = slice(), k522 = point(), a523 = list(), y524 = mark(), c525 = adder(), x526 = parsed();
  const b527 = box(), d528 = fraction(), s529 = narrow(), i530 = int(), e531 = either(), t532 = flag(), g533 = big(), l534 = large(), z535 = special(), w536 = wide(), r537 = rope(), p538 = slice(), k539 = point(), a540 = list(), y541 = mark(), c542 = adder(), x543 = parsed();
  const b544 = box(), d545 = fraction(), s546 = narrow(), i547 = int(), e548 = either(), t549 = flag(), g550 = big(), l551 = large(), z552 = special(), w553 = wide(), r554 = rope(), p555 = slice(), k556 = point(), a557 = list(), y558 = mark(), c559 = adder(), x560 = parsed();
  const b561 = box(), d562 = fraction(), s563 = narrow(), i564 = int(), e565 = either(), t566 = flag(), g567 = big(), l568 = large(), z569 = special(), w570 = wide(), r571 = rope(), p572 = slice(), k573 = point(), a574 = list(), y575 = mark(), c576 = adder(), x577 = parsed();
  const b578 = box(), d579 = fraction(), s580 = narrow(), i581 = int(), e582 = either(), t583 = flag(), g584 = big(), l585 = large(), z586 = special(), w587 = wide(), r588 = rope(), p589 = slice(), k590 = point(), a591 = list(), y592 = mark(), c593 = adder(), x594 = parsed();
  const b595 = box(), d596 = fraction(), s597 = narrow(), i598 = int(), e599 = either(), t600 = flag(), g601 = big(), l602 = large(), z603 = special(), w604 = wide(), r605 = rope(), p606 = slice(), k607 = point(), a608 = list(), y609 = mark(), c610 = adder(), x611 = parsed();
  const b612 = box(), d613 = fraction(), s614 = narrow(), i615 = int(), e616 = either(), t617 = flag(), g618 = big(), l619 = large(), z620 = special(), w621 = wide(), r622 = rope(), p623 = slice(), k624 = point(), a625 = list(), y626 = mark(), c627 = adder(), x628 = parsed();
  const b629 = box(), d630 = fraction(), s631 = narrow(), i632 = int(), e633 = either(), t634 = flag(), g635 = big(), l636 = large(), z637 = special(), w638 = wide(), r639 = rope(), p640 = slice(), k641 = point(), a642 = list(), y643 = mark(), c644 = adder(), x645 = parsed();
  const b646 = box(), d647 = fraction(), s648 = narrow(), i649 = int(), e650 = either(), t651 = flag(), g652 = big(), l653 = large(), z654 = special(), w655 = wide(), r656 = rope(), p657 = slice(), k658 = point(), a659 = list(), y660 = mark(), c661 = adder(), x662 = parsed();
  const b663 = box(), d664 = fraction(), s665 = narrow(), i666 = int(), e667 = either(), t668 = flag(), g669 = big(), l670 = large(), z671 = special(), w672 = wide(), r673 = rope(), p674 = slice(), k675 = point(), a676 = list(), y677 = mark(), c678 = adder(), x679 = parsed();
  const b680 = box(), d681 = fraction(), s682 = narrow(), i683 = int(), e684 = either(), t685 = flag(), g686 = big(), l687 = large(), z688 = special(), w689 = wide(), r690 = rope(), p691 = slice(), k692 = point(), a693 = list(), y694 = mark(), c695 = adder(), x696 = parsed();
  const b697 = box(), d698 = fraction(), s699 = narrow(), i700 = int(), e701 = either(), t702 = flag(), g703 = big(), l704 = large(), z705 = special(), w706 = wide(), r707 = rope(), p708 = slice(), k709 = point(), a710 = list(), y711 = mark(), c712 = adder(), x713 = parsed();
  const b714 = box(), d715 = fraction(), s716 = narrow(), i717 = int(), e718 = either(), t719 = flag(), g720 = big(), l721 = large(), z722 = special(), w723 = wide(), r724 = rope(), p725 = slice(), k726 = point(), a727 = list(), y728 = mark(), c729 = adder(), x730 = parsed();
  const b731 = box(), d732 = fraction(), s733 = narrow(), i734 = int(), e735 = either(), t736 = flag(), g737 = big(), l738 = large(), z739 = special(), w740 = wide(), r741 = rope(), p742 = slice(), k743 = point(), a744 = list(), y745 = mark(), c746 = adder(), x747 = parsed();
  const b748 = box(), d749 = fraction(), s750 = narrow(), i751 = int(), e752 = either(), t753 = flag(), g754 = big(), l755 = large(), z756 = special(), w757 = wide(), r758 = rope(), p759 = slice(), k760 = point(), a761 = list(), y762 = mark(), c763 = adder(), x764 = parsed();
  const b765 = box(), d766 = fraction(), s767 = narrow(), i768 = int(), e769 = either(), t770 = flag(), g771 = big(), l772 = large(), z773 = special(), w774 = wide(), r775 = rope(), p776 = slice(), k777 = point(), a778 = list(), y779 = mark(), c780 = adder(), x781 = parsed();
  const b782 = box(), d783 = fraction(), s784 = narrow(), i785 = int(), e786 = either(), t787 = flag(), g788 = big(), l789 = large(), z790 = special(), w791 = wide(), r792 = rope(), p793 = slice(), k794 = point(), a795 = list(), y796 = mark(), c797 = adder(), x798 = parsed();
  const b799 = box(), d800 = fraction(), s801 = narrow(), i802 = int(), e803 = either(), t804 = flag(), g805 = big(), l806 = large(), z807 = special(), w808 = wide(), r809 = rope(), p810 = slice(), k811 = point(), a812 = list(), y813 = mark(), c814 = adder(), x815 = parsed();
  const b816 = box(), d817 = fraction(), s818 = narrow(), i819 = int(), e820 = either(), t821 = flag(), g822 = big(), l823 = large(), z824 = special(), w825 = wide(), r826 = rope(), p827 = slice(), k828 = point(), a829 = list(), y830 = mark(), c831 = adder(), x832 = parsed();
  const b833 = box(), d834 = fraction(), s835 = narrow(), i836 = int(), e837 = either(), t838 = flag(), g839 = big(), l840 = large(), z841 = special(), w842 = wide(), r843 = rope(), p844 = slice(), k845 = point(), a846 = list(), y847 = mark(), c848 = adder(), x849 = parsed();
  const b850 = box(), d851 = fraction(), s852 = narrow(), i853 = int(), e854 = either(), t855 = flag(), g856 = big(), l857 = large(), z858 = special(), w859 = wide(), r860 = rope(), p861 = slice(), k862 = point(), a863 = list(), y864 = mark(), c865 = adder(), x866 = parsed();
  const b867 = box(), d868 = fraction(), s869 = narrow(), i870 = int(), e871 = either(), t872 = flag(), g873 = big(), l874 = large(), z875 = special(), w876 = wide(), r877 = rope(), p878 = slice(), k879 = point(), a880 = list(), y881 = mark(), c882 = adder(), x883 = parsed();
  const b884 = box(), d885 = fraction(), s886 = narrow(), i887 = int(), e888 = either(), t889 = flag(), g890 = big(), l891 = large(), z892 = special(), w893 = wide(), r894 = rope(), p895 = slice(), k896 = point(), a897 = list(), y898 = mark(), c899 = adder(), x900 = parsed();
  const b901 = box(), d902 = fraction(), s903 = narrow(), i904 = int(), e905 = either(), t906 = flag(), g907 = big(), l908 = large(), z909 = special(), w910 = wide(), r911 = rope(), p912 = slice(), k913 = point(), a914 = list(), y915 = mark(), c916 = adder(), x917 = parsed();
  const b918 = box(), d919 = fraction(), s920 = narrow(), i921 = int(), e922 = either(), t923 = flag(), g924 = big(), l925 = large(), z926 = special(), w927 = wide(), r928 = rope(), p929 = slice(), k930 = point(), a931 = list(), y932 = mark(), c933 = adder(), x934 = parsed();
  const b935 = box(), d936 = fraction(), s937 = narrow(), i938 = int(), e939 = either(), t940 = flag(), g941 = big(), l942 = large(), z943 = special(), w944 = wide(), r945 = rope(), p946 = slice(), k947 = point(), a948 = list(), y949 = mark(), c950 = adder(), x951 = parsed();
  const b952 = box(), d953 = fraction(), s954 = narrow(), i955 = int(), e956 = either(), t957 = flag(), g958 = big(), l959 = large(), z960 = special(), w961 = wide(), r962 = rope(), p963 = slice(), k964 = point(), a965 = list(), y966 = mark(), c967 = adder(), x968 = parsed();
  const b969 = box(), d970 = fraction(), s971 = narrow(), i972 = int(), e973 = either(), t974 = flag(), g975 = big(), l976 = large(), z977 = special(), w978 = wide(), r979 = rope(), p980 = slice(), k981 = point(), a982 = list(), y983 = mark(), c984 = adder(), x985 = parsed();
  const b986 = box(), d987 = fraction(), s988 = narrow(), i989 = int(), e990 = either(), t991 = flag(), g992 = big(), l993 = large(), z994 = special(), w995 = wide(), r996 = rope(), p997 = slice(), k998 = point(), a999 = list(), y1000 = mark(), c1001 = adder(), x1002 = parsed();
  const b1003 = box(), d1004 = fraction(), s1005 = narrow(), i1006 = int(), e1007 = either(), t1008 = flag(), g1009 = big(), l1010 = large(), z1011 = special(), w1012 = wide(), r1013 = rope(), p1014 = slice(), k1015 = point(), a1016 = list(), y1017 = mark(), c1018 = adder(), x1019 = parsed();
  const b1020 = box(), d1021 = fraction(), s1022 = narrow(), i1023 = int(), e1024 = either(), t1025 = flag(), g1026 = big(), l1027 = large(), z1028 = special(), w1029 = wide(), r1030 = rope(), p1031 = slice(), k1032 = point(), a1033 = list(), y1034 = mark(), c1035 = adder(), x1036 = parsed();
  const b1037 = box(), d1038 = fraction(), s1039 = narrow(), i1040 = int(), e1041 = either(), t1042 = flag(), g1043 = big(), l1044 = large(), z1045 = special(), w1046 = wide(), r1047 = rope(), p1048 = slice(), k1049 = point(), a1050 = list(), y1051 = mark(), c1052 = adder(), x1053 = parsed();
  const b1054 = box(), d1055 = fraction(), s1056 = narrow(), i1057 = int(), e1058 = either(), t1059 = flag(), g1060 = big(), l1061 = large(), z1062 = special(), w1063 = wide(), r1064 = rope(), p1065 = slice(), k1066 = point(), a1067 = list(), y1068 = mark(), c1069 = adder(), x1070 = parsed();
  const b1071 = box(), d1072 = fraction(), s1073 = narrow(), i1074 = int(), e1075 = either(), t1076 = flag(), g1077 = big(), l1078 = large(), z1079 = special(), w1080 = wide(), r1081 = rope(), p1082 = slice(), k1083 = point(), a1084 = list(), y1085 = mark(), c1086 = adder(), x1087 = parsed();
  const b1088 = box(), d1089 = fraction(), s1090 = narrow(), i1091 = int(), e1092 = either(), t1093 = flag(), g1094 = big(), l1095 = large(), z1096 = special(), w1097 = wide(), r1098 = rope(), p1099 = slice(), k1100 = point(), a1101 = list(), y1102 = mark(), c1103 = adder(), x1104 = parsed();
  const b1105 = box(), d1106 = fraction(), s1107 = narrow(), i1108 = int(), e1109 = either(), t1110 = flag(), g1111 = big(), l1112 = large(), z1113 = special(), w1114 = wide(), r1115 = rope(), p1116 = slice(), k1117 = point(), a1118 = list(), y1119 = mark(), c1120 = adder(), x1121 = parsed();
  const b1122 = box(), d1123 = fraction(), s1124 = narrow(), i1125 = int(), e1126 = either(), t1127 = flag(), g1128 = big(), l1129 = large(), z1130 = special(), w1131 = wide(), r1132 = rope(), p1133 = slice(), k1134 = point(), a1135 = list(), y1136 = mark(), c1137 = adder(), x1138 = parsed();
  const b1139 = box(), d1140 = fraction(), s1141 = narrow(), i1142 = int(), e1143 = either(), t1144 = flag(), g1145 = big(), l1146 = large(), z1147 = special(), w1148 = wide(), r1149 = rope(), p1150 = slice(), k1151 = point(), a1152 = list(), y1153 = mark(), c1154 = adder(), x1155 = parsed();
  const b1156 = box(), d1157 = fraction(), s1158 = narrow(), i1159 = int(), e1160 = either(), t1161 = flag(), g1162 = big(), l1163 = large(), z1164 = special(), w1165 = wide(), r1166 = rope(), p1167 = slice(), k1168 = point(), a1169 = list(), y1170 = mark(), c1171 = adder(), x1172 = parsed();
  const b1173 = box(), d1174 = fraction(), s1175 = narrow(), i1176 = int(), e1177 = either(), t1178 = flag(), g1179 = big(), l1180 = large(), z1181 = special(), w1182 = wide(), r1183 = rope(), p1184 = slice(), k1185 = point(), a1186 = list(), y1187 = mark(), c1188 = adder(), x1189 = parsed();
  const b1190 = box(), d1191 = fraction(), s1192 = narrow(), i1193 = int(), e1194 = either(), t1195 = flag(), g1196 = big(), l1197 = large(), z1198 = special(), w1199 = wide(), r1200 = rope(), p1201 = slice(), k1202 = point(), a1203 = list(), y1204 = mark(), c1205 = adder(), x1206 = parsed();
  const b1207 = box(), d1208 = fraction(), s1209 = narrow(), i1210 = int(), e1211 = either(), t1212 = flag(), g1213 = big(), l1214 = large(), z1215 = special(), w1216 = wide(), r1217 = rope(), p1218 = slice(), k1219 = point(), a1220 = list(), y1221 = mark(), c1222 = adder(), x1223 = parsed();
  const b1224 = box(), d1225 = fraction(), s1226 = narrow(), i1227 = int(), e1228 = either(), t1229 = flag(), g1230 = big(), l1231 = large(), z1232 = special(), w1233 = wide(), r1234 = rope(), p1235 = slice(), k1236 = point(), a1237 = list(), y1238 = mark(), c1239 = adder(), x1240 = parsed();
  const b1241 = box(), d1242 = fraction(), s1243 = narrow(), i1244 = int(), e1245 = either(), t1246 = flag(), g1247 = big(), l1248 = large(), z1249 = special(), w1250 = wide(), r1251 = rope(), p1252 = slice(), k1253 = point(), a1254 = list(), y1255 = mark(), c1256 = adder(), x1257 = parsed();
  const b1258 = box(), d1259 = fraction(), s1260 = narrow(), i1261 = int(), e1262 = either(), t1263 = flag(), g1264 = big(), l1265 = large(), z1266 = special(), w1267 = wide(), r1268 = rope(), p1269 = slice(), k1270 = point(), a1271 = list(), y1272 = mark(), c1273 = adder(), x1274 = parsed();
  const b1275 = box(), d1276 = fraction(), s1277 = narrow(), i1278 = int(), e1279 = either(), t1280 = flag(), g1281 = big(), l1282 = large(), z1283 = special(), w1284 = wide(), r1285 = rope(), p1286 = slice(), k1287 = point(), a1288 = list(), y1289 = mark(), c1290 = adder(), x1291 = parsed();
  const b1292 = box(), d1293 = fraction(), s1294 = narrow(), i1295 = int(), e1296 = either(), t1297 = flag(), g1298 = big(), l1299 = large(), z1300 = special(), w1301 = wide(), r1302 = rope(), p1303 = slice(), k1304 = point(), a1305 = list(), y1306 = mark(), c1307 = adder(), x1308 = parsed();
  const b1309 = box(), d1310 = fraction(), s1311 = narrow(), i1312 = int(), e1313 = either(), t1314 = flag(), g1315 = big(), l1316 = large(), z1317 = special(), w1318 = wide(), r1319 = rope(), p1320 = slice(), k1321 = point(), a1322 = list(), y1323 = mark(), c1324 = adder(), x1325 = parsed();
  const b1326 = box(), d1327 = fraction(), s1328 = narrow(), i1329 = int(), e1330 = either(), t1331 = flag(), g1332 = big(), l1333 = large(), z1334 = special(), w1335 = wide(), r1336 = rope(), p1337 = slice(), k1338 = point(), a1339 = list(), y1340 = mark(), c1341 = adder(), x1342 = parsed();
  const b1343 = box(), d1344 = fraction(), s1345 = narrow(), i1346 = int(), e1347 = either(), t1348 = flag(), g1349 = big(), l1350 = large(), z1351 = special(), w1352 = wide(), r1353 = rope(), p1354 = slice(), k1355 = point(), a1356 = list(), y1357 = mark(), c1358 = adder(), x1359 = parsed();
  const b1360 = box(), d1361 = fraction(), s1362 = narrow(), i1363 = int(), e1364 = either(), t1365 = flag(), g1366 = big(), l1367 = large(), z1368 = special(), w1369 = wide(), r1370 = rope(), p1371 = slice(), k1372 = point(), a1373 = list(), y1374 = mark(), c1375 = adder(), x1376 = parsed();
  const b1377 = box(), d1378 = fraction(), s1379 = narrow(), i1380 = int(), e1381 = either(), t1382 = flag(), g1383 = big(), l1384 = large(), z1385 = special(), w1386 = wide(), r1387 = rope(), p1388 = slice(), k1389 = point(), a1390 = list(), y1391 = mark(), c1392 = adder(), x1393 = parsed();
  const b1394 = box(), d1395 = fraction(), s1396 = narrow(), i1397 = int(), e1398 = either(), t1399 = flag(), g1400 = big(), l1401 = large(), z1402 = special(), w1403 = wide(), r1404 = rope(), p1405 = slice(), k1406 = point(), a1407 = list(), y1408 = mark(), c1409 = adder(), x1410 = parsed();
  const b1411 = box(), d1412 = fraction(), s1413 = narrow(), i1414 = int(), e1415 = either(), t1416 = flag(), g1417 = big(), l1418 = large(), z1419 = special(), w1420 = wide(), r1421 = rope(), p1422 = slice(), k1423 = point(), a1424 = list(), y1425 = mark(), c1426 = adder(), x1427 = parsed();
  const b1428 = box(), d1429 = fraction(), s1430 = narrow(), i1431 = int(), e1432 = either(), t1433 = flag(), g1434 = big(), l1435 = large(), z1436 = special(), w1437 = wide(), r1438 = rope(), p1439 = slice(), k1440 = point(), a1441 = list(), y1442 = mark(), c1443 = adder(), x1444 = parsed();
  const b1445 = box(), d1446 = fraction(), s1447 = narrow(), i1448 = int(), e1449 = either(), t1450 = flag(), g1451 = big(), l1452 = large(), z1453 = special(), w1454 = wide(), r1455 = rope(), p1456 = slice(), k1457 = point(), a1458 = list(), y1459 = mark(), c1460 = adder(), x1461 = parsed();
  const b1462 = box(), d1463 = fraction(), s1464 = narrow(), i1465 = int(), e1466 = either(), t1467 = flag(), g1468 = big(), l1469 = large(), z1470 = special(), w1471 = wide(), r1472 = rope(), p1473 = slice(), k1474 = point(), a1475 = list(), y1476 = mark(), c1477 = adder(), x1478 = parsed();
  const b1479 = box(), d1480 = fraction(), s1481 = narrow(), i1482 = int(), e1483 = either(), t1484 = flag(), g1485 = big(), l1486 = large(), z1487 = special(), w1488 = wide(), r1489 = rope(), p1490 = slice(), k1491 = point(), a1492 = list(), y1493 = mark(), c1494 = adder(), x1495 = parsed();
  const b1496 = box(), d1497 = fraction(), s1498 = narrow(), i1499 = int(), e1500 = either(), t1501 = flag(), g1502 = big(), l1503 = large(), z1504 = special(), w1505 = wide(), r1506 = rope(), p1507 = slice(), k1508 = point(), a1509 = list(), y1510 = mark(), c1511 = adder(), x1512 = parsed();
  const b1513 = box(), d1514 = fraction(), s1515 = narrow(), i1516 = int(), e1517 = either(), t1518 = flag(), g1519 = big(), l1520 = large(), z1521 = special(), w1522 = wide(), r1523 = rope(), p1524 = slice(), k1525 = point(), a1526 = list(), y1527 = mark(), c1528 = adder(), x1529 = parsed();
  const b1530 = box(), d1531 = fraction(), s1532 = narrow(), i1533 = int(), e1534 = either(), t1535 = flag(), g1536 = big(), l1537 = large(), z1538 = special(), w1539 = wide(), r1540 = rope(), p1541 = slice(), k1542 = point(), a1543 = list(), y1544 = mark(), c1545 = adder(), x1546 = parsed();
  const b1547 = box(), d1548 = fraction(), s1549 = narrow(), i1550 = int(), e1551 = either(), t1552 = flag(), g1553 = big(), l1554 = large(), z1555 = special(), w1556 = wide(), r1557 = rope(), p1558 = slice(), k1559 = point(), a1560 = list(), y1561 = mark(), c1562 = adder(), x1563 = parsed();
  const b1564 = box(), d1565 = fraction(), s1566 = narrow(), i1567 = int(), e1568 = either(), t1569 = flag(), g1570 = big(), l1571 = large(), z1572 = special(), w1573 = wide(), r1574 = rope(), p1575 = slice(), k1576 = point(), a1577 = list(), y1578 = mark(), c1579 = adder(), x1580 = parsed();
  const b1581 = box(), d1582 = fraction(), s1583 = narrow(), i1584 = int(), e1585 = either(), t1586 = flag(), g1587 = big(), l1588 = large(), z1589 = special(), w1590 = wide(), r1591 = rope(), p1592 = slice(), k1593 = point(), a1594 = list(), y1595 = mark(), c1596 = adder(), x1597 = parsed();
  const b1598 = box(), d1599 = fraction(), s1600 = narrow(), i1601 = int(), e1602 = either(), t1603 = flag(), g1604 = big(), l1605 = large(), z1606 = special(), w1607 = wide(), r1608 = rope(), p1609 = slice(), k1610 = point(), a1611 = list(), y1612 = mark(), c1613 = adder(), x1614 = parsed();
  const b1615 = box(), d1616 = fraction(), s1617 = narrow(), i1618 = int(), e1619 = either(), t1620 = flag(), g1621 = big(), l1622 = large(), z1623 = special(), w1624 = wide(), r1625 = rope(), p1626 = slice(), k1627 = point(), a1628 = list(), y1629 = mark(), c1630 = adder(), x1631 = parsed();
  const b1632 = box(), d1633 = fraction(), s1634 = narrow(), i1635 = int(), e1636 = either(), t1637 = flag(), g1638 = big(), l1639 = large(), z1640 = special(), w1641 = wide(), r1642 = rope(), p1643 = slice(), k1644 = point(), a1645 = list(), y1646 = mark(), c1647 = adder(), x1648 = parsed();
  const b1649 = box(), d1650 = fraction(), s1651 = narrow(), i1652 = int(), e1653 = either(), t1654 = flag(), g1655 = big(), l1656 = large(), z1657 = special(), w1658 = wide(), r1659 = rope(), p1660 = slice(), k1661 = point(), a1662 = list(), y1663 = mark(), c1664 = adder(), x1665 = parsed();
  const b1666 = box(), d1667 = fraction(), s1668 = narrow(), i1669 = int(), e1670 = either(), t1671 = flag(), g1672 = big(), l1673 = large(), z1674 = special(), w1675 = wide(), r1676 = rope(), p1677 = slice(), k1678 = point(), a1679 = list(), y1680 = mark(), c1681 = adder(), x1682 = parsed();
  const b1683 = box(), d1684 = fraction(), s1685 = narrow(), i1686 = int(), e1687 = either(), t1688 = flag(), g1689 = big(), l1690 = large(), z1691 = special(), w1692 = wide(), r1693 = rope(), p1694 = slice(), k1695 = point(), a1696 = list(), y1697 = mark(), c1698 = adder(), x1699 = parsed();
  const b1700 = box(), d1701 = fraction(), s1702 = narrow(), i1703 = int(), e1704 = either(), t1705 = flag(), g1706 = big(), l1707 = large(), z1708 = special(), w1709 = wide(), r1710 = rope(), p1711 = slice(), k1712 = point(), a1713 = list(), y1714 = mark(), c1715 = adder(), x1716 = parsed();
  const b1717 = box(), d1718 = fraction(), s1719 = narrow(), i1720 = int(), e1721 = either(), t1722 = flag(), g1723 = big(), l1724 = large(), z1725 = special(), w1726 = wide(), r1727 = rope(), p1728 = slice(), k1729 = point(), a1730 = list(), y1731 = mark(), c1732 = adder(), x1733 = parsed();
  const b1734 = box(), d1735 = fraction(), s1736 = narrow(), i1737 = int(), e1738 = either(), t1739 = flag(), g1740 = big(), l1741 = large(), z1742 = special(), w1743 = wide(), r1744 = rope(), p1745 = slice(), k1746 = point(), a1747 = list(), y1748 = mark(), c1749 = adder(), x1750 = parsed();
  const b1751 = box(), d1752 = fraction(), s1753 = narrow(), i1754 = int(), e1755 = either(), t1756 = flag(), g1757 = big(), l1758 = large(), z1759 = special(), w1760 = wide(), r1761 = rope(), p1762 = slice(), k1763 = point(), a1764 = list(), y1765 = mark(), c1766 = adder(), x1767 = parsed();
  const b1768 = box(), d1769 = fraction(), s1770 = narrow(), i1771 = int(), e1772 = either(), t1773 = flag(), g1774 = big(), l1775 = large(), z1776 = special(), w1777 = wide(), r1778 = rope(), p1779 = slice(), k1780 = point(), a1781 = list(), y1782 = mark(), c1783 = adder(), x1784 = parsed();
  const b1785 = box(), d1786 = fraction(), s1787 = narrow(), i1788 = int(), e1789 = either(), t1790 = flag(), g1791 = big(), l1792 = large(), z1793 = special(), w1794 = wide(), r1795 = rope(), p1796 = slice(), k1797 = point(), a1798 = list(), y1799 = mark(), c1800 = adder(), x1801 = parsed();
  const b1802 = box(), d1803 = fraction(), s1804 = narrow(), i1805 = int(), e1806 = either(), t1807 = flag(), g1808 = big(), l1809 = large(), z1810 = special(), w1811 = wide(), r1812 = rope(), p1813 = slice(), k1814 = point(), a1815 = list(), y1816 = mark(), c1817 = adder(), x1818 = parsed();
  const b1819 = box(), d1820 = fraction(), s1821 = narrow(), i1822 = int(), e1823 = either(), t1824 = flag(), g1825 = big(), l1826 = large(), z1827 = special(), w1828 = wide(), r1829 = rope(), p1830 = slice(), k1831 = point(), a1832 = list(), y1833 = mark(), c1834 = adder(), x1835 = parsed();
  const b1836 = box(), d1837 = fraction(), s1838 = narrow(), i1839 = int(), e1840 = either(), t1841 = flag(), g1842 = big(), l1843 = large(), z1844 = special(), w1845 = wide(), r1846 = rope(), p1847 = slice(), k1848 = point(), a1849 = list(), y1850 = mark(), c1851 = adder(), x1852 = parsed();
  const b1853 = box(), d1854 = fraction(), s1855 = narrow(), i1856 = int(), e1857 = either(), t1858 = flag(), g1859 = big(), l1860 = large(), z1861 = special(), w1862 = wide(), r1863 = rope(), p1864 = slice(), k1865 = point(), a1866 = list(), y1867 = mark(), c1868 = adder(), x1869 = parsed();
  const b1870 = box(), d1871 = fraction(), s1872 = narrow(), i1873 = int(), e1874 = either(), t1875 = flag(), g1876 = big(), l1877 = large(), z1878 = special(), w1879 = wide(), r1880 = rope(), p1881 = slice(), k1882 = point(), a1883 = list(), y1884 = mark(), c1885 = adder(), x1886 = parsed();
  const b1887 = box(), d1888 = fraction(), s1889 = narrow(), i1890 = int(), e1891 = either(), t1892 = flag(), g1893 = big(), l1894 = large(), z1895 = special(), w1896 = wide(), r1897 = rope(), p1898 = slice(), k1899 = point(), a1900 = list(), y1901 = mark(), c1902 = adder(), x1903 = parsed();
  const b1904 = box(), d1905 = fraction(), s1906 = narrow(), i1907 = int(), e1908 = either(), t1909 = flag(), g1910 = big(), l1911 = large(), z1912 = special(), w1913 = wide(), r1914 = rope(), p1915 = slice(), k1916 = point(), a1917 = list(), y1918 = mark(), c1919 = adder(), x1920 = parsed();
  const b1921 = box(), d1922 = fraction(), s1923 = narrow(), i1924 = int(), e1925 = either(), t1926 = flag(), g1927 = big(), l1928 = large(), z1929 = special(), w1930 = wide(), r1931 = rope(), p1932 = slice(), k1933 = point(), a1934 = list(), y1935 = mark(), c1936 = adder(), x1937 = parsed();
  const b1938 = box(), d1939 = fraction(), s1940 = narrow(), i1941 = int(), e1942 = either(), t1943 = flag(), g1944 = big(), l1945 = large(), z1946 = special(), w1947 = wide(), r1948 = rope(), p1949 = slice(), k1950 = point(), a1951 = list(), y1952 = mark(), c1953 = adder(), x1954 = parsed();
  const b1955 = box(), d1956 = fraction(), s1957 = narrow(), i1958 = int(), e1959 = either(), t1960 = flag(), g1961 = big(), l1962 = large(), z1963 = special(), w1964 = wide(), r1965 = rope(), p1966 = slice(), k1967 = point(), a1968 = list(), y1969 = mark(), c1970 = adder(), x1971 = parsed();
  const b1972 = box(), d1973 = fraction(), s1974 = narrow(), i1975 = int(), e1976 = either(), t1977 = flag(), g1978 = big(), l1979 = large(), z1980 = special(), w1981 = wide(), r1982 = rope(), p1983 = slice(), k1984 = point(), a1985 = list(), y1986 = mark(), c1987 = adder(), x1988 = parsed();
  const b1989 = box(), d1990 = fraction(), s1991 = narrow(), i1992 = int(), e1993 = either(), t1994 = flag(), g1995 = big(), l1996 = large(), z1997 = special(), w1998 = wide(), r1999 = rope();
  let h = await waitsFor(gate);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = fold(h, b289, d290, s291, i292, e293, t294, g295, l296, z297, w298, r299, p300, k301, a302, y303, c304, x305);
  h = fold(h, b306, d307, s308, i309, e310, t311, g312, l313, z314, w315, r316, p317, k318, a319, y320, c321, x322);
  h = fold(h, b323, d324, s325, i326, e327, t328, g329, l330, z331, w332, r333, p334, k335, a336, y337, c338, x339);
  h = fold(h, b340, d341, s342, i343, e344, t345, g346, l347, z348, w349, r350, p351, k352, a353, y354, c355, x356);
  h = fold(h, b357, d358, s359, i360, e361, t362, g363, l364, z365, w366, r367, p368, k369, a370, y371, c372, x373);
  h = fold(h, b374, d375, s376, i377, e378, t379, g380, l381, z382, w383, r384, p385, k386, a387, y388, c389, x390);
  h = fold(h, b391, d392, s393, i394, e395, t396, g397, l398, z399, w400, r401, p402, k403, a404, y405, c406, x407);
  h = fold(h, b408, d409, s410, i411, e412, t413, g414, l415, z416, w417, r418, p419, k420, a421, y422, c423, x424);
  h = fold(h, b425, d426, s427, i428, e429, t430, g431, l432, z433, w434, r435, p436, k437, a438, y439, c440, x441);
  h = fold(h, b442, d443, s444, i445, e446, t447, g448, l449, z450, w451, r452, p453, k454, a455, y456, c457, x458);
  h = fold(h, b459, d460, s461, i462, e463, t464, g465, l466, z467, w468, r469, p470, k471, a472, y473, c474, x475);
  h = fold(h, b476, d477, s478, i479, e480, t481, g482, l483, z484, w485, r486, p487, k488, a489, y490, c491, x492);
  h = fold(h, b493, d494, s495, i496, e497, t498, g499, l500, z501, w502, r503, p504, k505, a506, y507, c508, x509);
  h = fold(h, b510, d511, s512, i513, e514, t515, g516, l517, z518, w519, r520, p521, k522, a523, y524, c525, x526);
  h = fold(h, b527, d528, s529, i530, e531, t532, g533, l534, z535, w536, r537, p538, k539, a540, y541, c542, x543);
  h = fold(h, b544, d545, s546, i547, e548, t549, g550, l551, z552, w553, r554, p555, k556, a557, y558, c559, x560);
  h = fold(h, b561, d562, s563, i564, e565, t566, g567, l568, z569, w570, r571, p572, k573, a574, y575, c576, x577);
  h = fold(h, b578, d579, s580, i581, e582, t583, g584, l585, z586, w587, r588, p589, k590, a591, y592, c593, x594);
  h = fold(h, b595, d596, s597, i598, e599, t600, g601, l602, z603, w604, r605, p606, k607, a608, y609, c610, x611);
  h = fold(h, b612, d613, s614, i615, e616, t617, g618, l619, z620, w621, r622, p623, k624, a625, y626, c627, x628);
  h = fold(h, b629, d630, s631, i632, e633, t634, g635, l636, z637, w638, r639, p640, k641, a642, y643, c644, x645);
  h = fold(h, b646, d647, s648, i649, e650, t651, g652, l653, z654, w655, r656, p657, k658, a659, y660, c661, x662);
  h = fold(h, b663, d664, s665, i666, e667, t668, g669, l670, z671, w672, r673, p674, k675, a676, y677, c678, x679);
  h = fold(h, b680, d681, s682, i683, e684, t685, g686, l687, z688, w689, r690, p691, k692, a693, y694, c695, x696);
  h = fold(h, b697, d698, s699, i700, e701, t702, g703, l704, z705, w706, r707, p708, k709, a710, y711, c712, x713);
  h = fold(h, b714, d715, s716, i717, e718, t719, g720, l721, z722, w723, r724, p725, k726, a727, y728, c729, x730);
  h = fold(h, b731, d732, s733, i734, e735, t736, g737, l738, z739, w740, r741, p742, k743, a744, y745, c746, x747);
  h = fold(h, b748, d749, s750, i751, e752, t753, g754, l755, z756, w757, r758, p759, k760, a761, y762, c763, x764);
  h = fold(h, b765, d766, s767, i768, e769, t770, g771, l772, z773, w774, r775, p776, k777, a778, y779, c780, x781);
  h = fold(h, b782, d783, s784, i785, e786, t787, g788, l789, z790, w791, r792, p793, k794, a795, y796, c797, x798);
  h = fold(h, b799, d800, s801, i802, e803, t804, g805, l806, z807, w808, r809, p810, k811, a812, y813, c814, x815);
  h = fold(h, b816, d817, s818, i819, e820, t821, g822, l823, z824, w825, r826, p827, k828, a829, y830, c831, x832);
  h = fold(h, b833, d834, s835, i836, e837, t838, g839, l840, z841, w842, r843, p844, k845, a846, y847, c848, x849);
  h = fold(h, b850, d851, s852, i853, e854, t855, g856, l857, z858, w859, r860, p861, k862, a863, y864, c865, x866);
  h = fold(h, b867, d868, s869, i870, e871, t872, g873, l874, z875, w876, r877, p878, k879, a880, y881, c882, x883);
  h = fold(h, b884, d885, s886, i887, e888, t889, g890, l891, z892, w893, r894, p895, k896, a897, y898, c899, x900);
  h = fold(h, b901, d902, s903, i904, e905, t906, g907, l908, z909, w910, r911, p912, k913, a914, y915, c916, x917);
  h = fold(h, b918, d919, s920, i921, e922, t923, g924, l925, z926, w927, r928, p929, k930, a931, y932, c933, x934);
  h = fold(h, b935, d936, s937, i938, e939, t940, g941, l942, z943, w944, r945, p946, k947, a948, y949, c950, x951);
  h = fold(h, b952, d953, s954, i955, e956, t957, g958, l959, z960, w961, r962, p963, k964, a965, y966, c967, x968);
  h = fold(h, b969, d970, s971, i972, e973, t974, g975, l976, z977, w978, r979, p980, k981, a982, y983, c984, x985);
  h = fold(h, b986, d987, s988, i989, e990, t991, g992, l993, z994, w995, r996, p997, k998, a999, y1000, c1001, x1002);
  h = fold(h, b1003, d1004, s1005, i1006, e1007, t1008, g1009, l1010, z1011, w1012, r1013, p1014, k1015, a1016, y1017, c1018, x1019);
  h = fold(h, b1020, d1021, s1022, i1023, e1024, t1025, g1026, l1027, z1028, w1029, r1030, p1031, k1032, a1033, y1034, c1035, x1036);
  h = fold(h, b1037, d1038, s1039, i1040, e1041, t1042, g1043, l1044, z1045, w1046, r1047, p1048, k1049, a1050, y1051, c1052, x1053);
  h = fold(h, b1054, d1055, s1056, i1057, e1058, t1059, g1060, l1061, z1062, w1063, r1064, p1065, k1066, a1067, y1068, c1069, x1070);
  h = fold(h, b1071, d1072, s1073, i1074, e1075, t1076, g1077, l1078, z1079, w1080, r1081, p1082, k1083, a1084, y1085, c1086, x1087);
  h = fold(h, b1088, d1089, s1090, i1091, e1092, t1093, g1094, l1095, z1096, w1097, r1098, p1099, k1100, a1101, y1102, c1103, x1104);
  h = fold(h, b1105, d1106, s1107, i1108, e1109, t1110, g1111, l1112, z1113, w1114, r1115, p1116, k1117, a1118, y1119, c1120, x1121);
  h = fold(h, b1122, d1123, s1124, i1125, e1126, t1127, g1128, l1129, z1130, w1131, r1132, p1133, k1134, a1135, y1136, c1137, x1138);
  h = fold(h, b1139, d1140, s1141, i1142, e1143, t1144, g1145, l1146, z1147, w1148, r1149, p1150, k1151, a1152, y1153, c1154, x1155);
  h = fold(h, b1156, d1157, s1158, i1159, e1160, t1161, g1162, l1163, z1164, w1165, r1166, p1167, k1168, a1169, y1170, c1171, x1172);
  h = fold(h, b1173, d1174, s1175, i1176, e1177, t1178, g1179, l1180, z1181, w1182, r1183, p1184, k1185, a1186, y1187, c1188, x1189);
  h = fold(h, b1190, d1191, s1192, i1193, e1194, t1195, g1196, l1197, z1198, w1199, r1200, p1201, k1202, a1203, y1204, c1205, x1206);
  h = fold(h, b1207, d1208, s1209, i1210, e1211, t1212, g1213, l1214, z1215, w1216, r1217, p1218, k1219, a1220, y1221, c1222, x1223);
  h = fold(h, b1224, d1225, s1226, i1227, e1228, t1229, g1230, l1231, z1232, w1233, r1234, p1235, k1236, a1237, y1238, c1239, x1240);
  h = fold(h, b1241, d1242, s1243, i1244, e1245, t1246, g1247, l1248, z1249, w1250, r1251, p1252, k1253, a1254, y1255, c1256, x1257);
  h = fold(h, b1258, d1259, s1260, i1261, e1262, t1263, g1264, l1265, z1266, w1267, r1268, p1269, k1270, a1271, y1272, c1273, x1274);
  h = fold(h, b1275, d1276, s1277, i1278, e1279, t1280, g1281, l1282, z1283, w1284, r1285, p1286, k1287, a1288, y1289, c1290, x1291);
  h = fold(h, b1292, d1293, s1294, i1295, e1296, t1297, g1298, l1299, z1300, w1301, r1302, p1303, k1304, a1305, y1306, c1307, x1308);
  h = fold(h, b1309, d1310, s1311, i1312, e1313, t1314, g1315, l1316, z1317, w1318, r1319, p1320, k1321, a1322, y1323, c1324, x1325);
  h = fold(h, b1326, d1327, s1328, i1329, e1330, t1331, g1332, l1333, z1334, w1335, r1336, p1337, k1338, a1339, y1340, c1341, x1342);
  h = fold(h, b1343, d1344, s1345, i1346, e1347, t1348, g1349, l1350, z1351, w1352, r1353, p1354, k1355, a1356, y1357, c1358, x1359);
  h = fold(h, b1360, d1361, s1362, i1363, e1364, t1365, g1366, l1367, z1368, w1369, r1370, p1371, k1372, a1373, y1374, c1375, x1376);
  h = fold(h, b1377, d1378, s1379, i1380, e1381, t1382, g1383, l1384, z1385, w1386, r1387, p1388, k1389, a1390, y1391, c1392, x1393);
  h = fold(h, b1394, d1395, s1396, i1397, e1398, t1399, g1400, l1401, z1402, w1403, r1404, p1405, k1406, a1407, y1408, c1409, x1410);
  h = fold(h, b1411, d1412, s1413, i1414, e1415, t1416, g1417, l1418, z1419, w1420, r1421, p1422, k1423, a1424, y1425, c1426, x1427);
  h = fold(h, b1428, d1429, s1430, i1431, e1432, t1433, g1434, l1435, z1436, w1437, r1438, p1439, k1440, a1441, y1442, c1443, x1444);
  h = fold(h, b1445, d1446, s1447, i1448, e1449, t1450, g1451, l1452, z1453, w1454, r1455, p1456, k1457, a1458, y1459, c1460, x1461);
  h = fold(h, b1462, d1463, s1464, i1465, e1466, t1467, g1468, l1469, z1470, w1471, r1472, p1473, k1474, a1475, y1476, c1477, x1478);
  h = fold(h, b1479, d1480, s1481, i1482, e1483, t1484, g1485, l1486, z1487, w1488, r1489, p1490, k1491, a1492, y1493, c1494, x1495);
  h = fold(h, b1496, d1497, s1498, i1499, e1500, t1501, g1502, l1503, z1504, w1505, r1506, p1507, k1508, a1509, y1510, c1511, x1512);
  h = fold(h, b1513, d1514, s1515, i1516, e1517, t1518, g1519, l1520, z1521, w1522, r1523, p1524, k1525, a1526, y1527, c1528, x1529);
  h = fold(h, b1530, d1531, s1532, i1533, e1534, t1535, g1536, l1537, z1538, w1539, r1540, p1541, k1542, a1543, y1544, c1545, x1546);
  h = fold(h, b1547, d1548, s1549, i1550, e1551, t1552, g1553, l1554, z1555, w1556, r1557, p1558, k1559, a1560, y1561, c1562, x1563);
  h = fold(h, b1564, d1565, s1566, i1567, e1568, t1569, g1570, l1571, z1572, w1573, r1574, p1575, k1576, a1577, y1578, c1579, x1580);
  h = fold(h, b1581, d1582, s1583, i1584, e1585, t1586, g1587, l1588, z1589, w1590, r1591, p1592, k1593, a1594, y1595, c1596, x1597);
  h = fold(h, b1598, d1599, s1600, i1601, e1602, t1603, g1604, l1605, z1606, w1607, r1608, p1609, k1610, a1611, y1612, c1613, x1614);
  h = fold(h, b1615, d1616, s1617, i1618, e1619, t1620, g1621, l1622, z1623, w1624, r1625, p1626, k1627, a1628, y1629, c1630, x1631);
  h = fold(h, b1632, d1633, s1634, i1635, e1636, t1637, g1638, l1639, z1640, w1641, r1642, p1643, k1644, a1645, y1646, c1647, x1648);
  h = fold(h, b1649, d1650, s1651, i1652, e1653, t1654, g1655, l1656, z1657, w1658, r1659, p1660, k1661, a1662, y1663, c1664, x1665);
  h = fold(h, b1666, d1667, s1668, i1669, e1670, t1671, g1672, l1673, z1674, w1675, r1676, p1677, k1678, a1679, y1680, c1681, x1682);
  h = fold(h, b1683, d1684, s1685, i1686, e1687, t1688, g1689, l1690, z1691, w1692, r1693, p1694, k1695, a1696, y1697, c1698, x1699);
  h = fold(h, b1700, d1701, s1702, i1703, e1704, t1705, g1706, l1707, z1708, w1709, r1710, p1711, k1712, a1713, y1714, c1715, x1716);
  h = fold(h, b1717, d1718, s1719, i1720, e1721, t1722, g1723, l1724, z1725, w1726, r1727, p1728, k1729, a1730, y1731, c1732, x1733);
  h = fold(h, b1734, d1735, s1736, i1737, e1738, t1739, g1740, l1741, z1742, w1743, r1744, p1745, k1746, a1747, y1748, c1749, x1750);
  h = fold(h, b1751, d1752, s1753, i1754, e1755, t1756, g1757, l1758, z1759, w1760, r1761, p1762, k1763, a1764, y1765, c1766, x1767);
  h = fold(h, b1768, d1769, s1770, i1771, e1772, t1773, g1774, l1775, z1776, w1777, r1778, p1779, k1780, a1781, y1782, c1783, x1784);
  h = fold(h, b1785, d1786, s1787, i1788, e1789, t1790, g1791, l1792, z1793, w1794, r1795, p1796, k1797, a1798, y1799, c1800, x1801);
  h = fold(h, b1802, d1803, s1804, i1805, e1806, t1807, g1808, l1809, z1810, w1811, r1812, p1813, k1814, a1815, y1816, c1817, x1818);
  h = fold(h, b1819, d1820, s1821, i1822, e1823, t1824, g1825, l1826, z1827, w1828, r1829, p1830, k1831, a1832, y1833, c1834, x1835);
  h = fold(h, b1836, d1837, s1838, i1839, e1840, t1841, g1842, l1843, z1844, w1845, r1846, p1847, k1848, a1849, y1850, c1851, x1852);
  h = fold(h, b1853, d1854, s1855, i1856, e1857, t1858, g1859, l1860, z1861, w1862, r1863, p1864, k1865, a1866, y1867, c1868, x1869);
  h = fold(h, b1870, d1871, s1872, i1873, e1874, t1875, g1876, l1877, z1878, w1879, r1880, p1881, k1882, a1883, y1884, c1885, x1886);
  h = fold(h, b1887, d1888, s1889, i1890, e1891, t1892, g1893, l1894, z1895, w1896, r1897, p1898, k1899, a1900, y1901, c1902, x1903);
  h = fold(h, b1904, d1905, s1906, i1907, e1908, t1909, g1910, l1911, z1912, w1913, r1914, p1915, k1916, a1917, y1918, c1919, x1920);
  h = fold(h, b1921, d1922, s1923, i1924, e1925, t1926, g1927, l1928, z1929, w1930, r1931, p1932, k1933, a1934, y1935, c1936, x1937);
  h = fold(h, b1938, d1939, s1940, i1941, e1942, t1943, g1944, l1945, z1946, w1947, r1948, p1949, k1950, a1951, y1952, c1953, x1954);
  h = fold(h, b1955, d1956, s1957, i1958, e1959, t1960, g1961, l1962, z1963, w1964, r1965, p1966, k1967, a1968, y1969, c1970, x1971);
  h = fold(h, b1972, d1973, s1974, i1975, e1976, t1977, g1978, l1979, z1980, w1981, r1982, p1983, k1984, a1985, y1986, c1987, x1988);
  h = ofBox(h, b1989); h = ofNumber(h, d1990); h = ofText(h, s1991); h = ofNumber(h, i1992); h = ofEither(h, e1993); h = ofFlag(h, t1994); h = ofBig(h, g1995); h = ofNumber(h, l1996); h = ofNumber(h, z1997); h = ofText(h, w1998); h = ofText(h, r1999);
  return h;
}

async function loopsOverStream0(gate: Promise<number>, collects: boolean): Promise<number> {
  let h = 0;
  for await (const value of streamOf(gate)) h = mix(h, value);
  if (collects) collect();
  return h;
}
async function loopsOverStream1(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box();
  let h = 0;
  for await (const value of streamOf(gate)) h = mix(h, value);
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
async function loopsOverStream7(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = 0;
  for await (const value of streamOf(gate)) h = mix(h, value);
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function loopsOverStream40(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = 0;
  for await (const value of streamOf(gate)) h = mix(h, value);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}
async function loopsOverStream300(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope();
  let h = 0;
  for await (const value of streamOf(gate)) h = mix(h, value);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = ofBox(h, b289); h = ofNumber(h, d290); h = ofText(h, s291); h = ofNumber(h, i292); h = ofEither(h, e293); h = ofFlag(h, t294); h = ofBig(h, g295); h = ofNumber(h, l296); h = ofNumber(h, z297); h = ofText(h, w298); h = ofText(h, r299);
  return h;
}

async function loopsOverList0(gate: Promise<number>, collects: boolean): Promise<number> {
  let h = 0;
  for await (const value of [2, gate, 4]) h = mix(h, value);
  if (collects) collect();
  return h;
}
async function loopsOverList1(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box();
  let h = 0;
  for await (const value of [2, gate, 4]) h = mix(h, value);
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
async function loopsOverList7(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = 0;
  for await (const value of [2, gate, 4]) h = mix(h, value);
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function loopsOverList40(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = 0;
  for await (const value of [2, gate, 4]) h = mix(h, value);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}
async function loopsOverList300(gate: Promise<number>, collects: boolean): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope();
  let h = 0;
  for await (const value of [2, gate, 4]) h = mix(h, value);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = ofBox(h, b289); h = ofNumber(h, d290); h = ofText(h, s291); h = ofNumber(h, i292); h = ofEither(h, e293); h = ofFlag(h, t294); h = ofBig(h, g295); h = ofNumber(h, l296); h = ofNumber(h, z297); h = ofText(h, w298); h = ofText(h, r299);
  return h;
}

async function takesAndAwaits1(gate: Promise<number>, collects: boolean, b0: Box): Promise<number> {
  let h = await gate;
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
async function takesAndAwaits7(gate: Promise<number>, collects: boolean, b0: Box, d1: number, s2: string, i3: number, e4: Either, t5: boolean, g6: bigint): Promise<number> {
  let h = await gate;
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function takesAndAwaits40(gate: Promise<number>, collects: boolean, b0: Box, d1: number, s2: string, i3: number, e4: Either, t5: boolean, g6: bigint, l7: number, z8: number, w9: string, r10: string, p11: string, k12: Point, a13: number[], y14: symbol, c15: Adds, x16: any, b17: Box, d18: number, s19: string, i20: number, e21: Either, t22: boolean, g23: bigint, l24: number, z25: number, w26: string, r27: string, p28: string, k29: Point, a30: number[], y31: symbol, c32: Adds, x33: any, b34: Box, d35: number, s36: string, i37: number, e38: Either, t39: boolean): Promise<number> {
  let h = await gate;
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}

function* yields0(seed: number, collects: boolean): Steps {
  let h = yield seed;
  if (collects) collect();
  return h;
}
function* yields1(seed: number, collects: boolean): Steps {
  const b0 = box();
  let h = yield seed;
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
function* yields7(seed: number, collects: boolean): Steps {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = yield seed;
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
function* yields40(seed: number, collects: boolean): Steps {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = yield seed;
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}
function* yields300(seed: number, collects: boolean): Steps {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope();
  let h = yield seed;
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = ofBox(h, b289); h = ofNumber(h, d290); h = ofText(h, s291); h = ofNumber(h, i292); h = ofEither(h, e293); h = ofFlag(h, t294); h = ofBig(h, g295); h = ofNumber(h, l296); h = ofNumber(h, z297); h = ofText(h, w298); h = ofText(h, r299);
  return h;
}
function* yields2000(seed: number, collects: boolean): Steps {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope(), p300 = slice(), k301 = point(), a302 = list(), y303 = mark(), c304 = adder(), x305 = parsed();
  const b306 = box(), d307 = fraction(), s308 = narrow(), i309 = int(), e310 = either(), t311 = flag(), g312 = big(), l313 = large(), z314 = special(), w315 = wide(), r316 = rope(), p317 = slice(), k318 = point(), a319 = list(), y320 = mark(), c321 = adder(), x322 = parsed();
  const b323 = box(), d324 = fraction(), s325 = narrow(), i326 = int(), e327 = either(), t328 = flag(), g329 = big(), l330 = large(), z331 = special(), w332 = wide(), r333 = rope(), p334 = slice(), k335 = point(), a336 = list(), y337 = mark(), c338 = adder(), x339 = parsed();
  const b340 = box(), d341 = fraction(), s342 = narrow(), i343 = int(), e344 = either(), t345 = flag(), g346 = big(), l347 = large(), z348 = special(), w349 = wide(), r350 = rope(), p351 = slice(), k352 = point(), a353 = list(), y354 = mark(), c355 = adder(), x356 = parsed();
  const b357 = box(), d358 = fraction(), s359 = narrow(), i360 = int(), e361 = either(), t362 = flag(), g363 = big(), l364 = large(), z365 = special(), w366 = wide(), r367 = rope(), p368 = slice(), k369 = point(), a370 = list(), y371 = mark(), c372 = adder(), x373 = parsed();
  const b374 = box(), d375 = fraction(), s376 = narrow(), i377 = int(), e378 = either(), t379 = flag(), g380 = big(), l381 = large(), z382 = special(), w383 = wide(), r384 = rope(), p385 = slice(), k386 = point(), a387 = list(), y388 = mark(), c389 = adder(), x390 = parsed();
  const b391 = box(), d392 = fraction(), s393 = narrow(), i394 = int(), e395 = either(), t396 = flag(), g397 = big(), l398 = large(), z399 = special(), w400 = wide(), r401 = rope(), p402 = slice(), k403 = point(), a404 = list(), y405 = mark(), c406 = adder(), x407 = parsed();
  const b408 = box(), d409 = fraction(), s410 = narrow(), i411 = int(), e412 = either(), t413 = flag(), g414 = big(), l415 = large(), z416 = special(), w417 = wide(), r418 = rope(), p419 = slice(), k420 = point(), a421 = list(), y422 = mark(), c423 = adder(), x424 = parsed();
  const b425 = box(), d426 = fraction(), s427 = narrow(), i428 = int(), e429 = either(), t430 = flag(), g431 = big(), l432 = large(), z433 = special(), w434 = wide(), r435 = rope(), p436 = slice(), k437 = point(), a438 = list(), y439 = mark(), c440 = adder(), x441 = parsed();
  const b442 = box(), d443 = fraction(), s444 = narrow(), i445 = int(), e446 = either(), t447 = flag(), g448 = big(), l449 = large(), z450 = special(), w451 = wide(), r452 = rope(), p453 = slice(), k454 = point(), a455 = list(), y456 = mark(), c457 = adder(), x458 = parsed();
  const b459 = box(), d460 = fraction(), s461 = narrow(), i462 = int(), e463 = either(), t464 = flag(), g465 = big(), l466 = large(), z467 = special(), w468 = wide(), r469 = rope(), p470 = slice(), k471 = point(), a472 = list(), y473 = mark(), c474 = adder(), x475 = parsed();
  const b476 = box(), d477 = fraction(), s478 = narrow(), i479 = int(), e480 = either(), t481 = flag(), g482 = big(), l483 = large(), z484 = special(), w485 = wide(), r486 = rope(), p487 = slice(), k488 = point(), a489 = list(), y490 = mark(), c491 = adder(), x492 = parsed();
  const b493 = box(), d494 = fraction(), s495 = narrow(), i496 = int(), e497 = either(), t498 = flag(), g499 = big(), l500 = large(), z501 = special(), w502 = wide(), r503 = rope(), p504 = slice(), k505 = point(), a506 = list(), y507 = mark(), c508 = adder(), x509 = parsed();
  const b510 = box(), d511 = fraction(), s512 = narrow(), i513 = int(), e514 = either(), t515 = flag(), g516 = big(), l517 = large(), z518 = special(), w519 = wide(), r520 = rope(), p521 = slice(), k522 = point(), a523 = list(), y524 = mark(), c525 = adder(), x526 = parsed();
  const b527 = box(), d528 = fraction(), s529 = narrow(), i530 = int(), e531 = either(), t532 = flag(), g533 = big(), l534 = large(), z535 = special(), w536 = wide(), r537 = rope(), p538 = slice(), k539 = point(), a540 = list(), y541 = mark(), c542 = adder(), x543 = parsed();
  const b544 = box(), d545 = fraction(), s546 = narrow(), i547 = int(), e548 = either(), t549 = flag(), g550 = big(), l551 = large(), z552 = special(), w553 = wide(), r554 = rope(), p555 = slice(), k556 = point(), a557 = list(), y558 = mark(), c559 = adder(), x560 = parsed();
  const b561 = box(), d562 = fraction(), s563 = narrow(), i564 = int(), e565 = either(), t566 = flag(), g567 = big(), l568 = large(), z569 = special(), w570 = wide(), r571 = rope(), p572 = slice(), k573 = point(), a574 = list(), y575 = mark(), c576 = adder(), x577 = parsed();
  const b578 = box(), d579 = fraction(), s580 = narrow(), i581 = int(), e582 = either(), t583 = flag(), g584 = big(), l585 = large(), z586 = special(), w587 = wide(), r588 = rope(), p589 = slice(), k590 = point(), a591 = list(), y592 = mark(), c593 = adder(), x594 = parsed();
  const b595 = box(), d596 = fraction(), s597 = narrow(), i598 = int(), e599 = either(), t600 = flag(), g601 = big(), l602 = large(), z603 = special(), w604 = wide(), r605 = rope(), p606 = slice(), k607 = point(), a608 = list(), y609 = mark(), c610 = adder(), x611 = parsed();
  const b612 = box(), d613 = fraction(), s614 = narrow(), i615 = int(), e616 = either(), t617 = flag(), g618 = big(), l619 = large(), z620 = special(), w621 = wide(), r622 = rope(), p623 = slice(), k624 = point(), a625 = list(), y626 = mark(), c627 = adder(), x628 = parsed();
  const b629 = box(), d630 = fraction(), s631 = narrow(), i632 = int(), e633 = either(), t634 = flag(), g635 = big(), l636 = large(), z637 = special(), w638 = wide(), r639 = rope(), p640 = slice(), k641 = point(), a642 = list(), y643 = mark(), c644 = adder(), x645 = parsed();
  const b646 = box(), d647 = fraction(), s648 = narrow(), i649 = int(), e650 = either(), t651 = flag(), g652 = big(), l653 = large(), z654 = special(), w655 = wide(), r656 = rope(), p657 = slice(), k658 = point(), a659 = list(), y660 = mark(), c661 = adder(), x662 = parsed();
  const b663 = box(), d664 = fraction(), s665 = narrow(), i666 = int(), e667 = either(), t668 = flag(), g669 = big(), l670 = large(), z671 = special(), w672 = wide(), r673 = rope(), p674 = slice(), k675 = point(), a676 = list(), y677 = mark(), c678 = adder(), x679 = parsed();
  const b680 = box(), d681 = fraction(), s682 = narrow(), i683 = int(), e684 = either(), t685 = flag(), g686 = big(), l687 = large(), z688 = special(), w689 = wide(), r690 = rope(), p691 = slice(), k692 = point(), a693 = list(), y694 = mark(), c695 = adder(), x696 = parsed();
  const b697 = box(), d698 = fraction(), s699 = narrow(), i700 = int(), e701 = either(), t702 = flag(), g703 = big(), l704 = large(), z705 = special(), w706 = wide(), r707 = rope(), p708 = slice(), k709 = point(), a710 = list(), y711 = mark(), c712 = adder(), x713 = parsed();
  const b714 = box(), d715 = fraction(), s716 = narrow(), i717 = int(), e718 = either(), t719 = flag(), g720 = big(), l721 = large(), z722 = special(), w723 = wide(), r724 = rope(), p725 = slice(), k726 = point(), a727 = list(), y728 = mark(), c729 = adder(), x730 = parsed();
  const b731 = box(), d732 = fraction(), s733 = narrow(), i734 = int(), e735 = either(), t736 = flag(), g737 = big(), l738 = large(), z739 = special(), w740 = wide(), r741 = rope(), p742 = slice(), k743 = point(), a744 = list(), y745 = mark(), c746 = adder(), x747 = parsed();
  const b748 = box(), d749 = fraction(), s750 = narrow(), i751 = int(), e752 = either(), t753 = flag(), g754 = big(), l755 = large(), z756 = special(), w757 = wide(), r758 = rope(), p759 = slice(), k760 = point(), a761 = list(), y762 = mark(), c763 = adder(), x764 = parsed();
  const b765 = box(), d766 = fraction(), s767 = narrow(), i768 = int(), e769 = either(), t770 = flag(), g771 = big(), l772 = large(), z773 = special(), w774 = wide(), r775 = rope(), p776 = slice(), k777 = point(), a778 = list(), y779 = mark(), c780 = adder(), x781 = parsed();
  const b782 = box(), d783 = fraction(), s784 = narrow(), i785 = int(), e786 = either(), t787 = flag(), g788 = big(), l789 = large(), z790 = special(), w791 = wide(), r792 = rope(), p793 = slice(), k794 = point(), a795 = list(), y796 = mark(), c797 = adder(), x798 = parsed();
  const b799 = box(), d800 = fraction(), s801 = narrow(), i802 = int(), e803 = either(), t804 = flag(), g805 = big(), l806 = large(), z807 = special(), w808 = wide(), r809 = rope(), p810 = slice(), k811 = point(), a812 = list(), y813 = mark(), c814 = adder(), x815 = parsed();
  const b816 = box(), d817 = fraction(), s818 = narrow(), i819 = int(), e820 = either(), t821 = flag(), g822 = big(), l823 = large(), z824 = special(), w825 = wide(), r826 = rope(), p827 = slice(), k828 = point(), a829 = list(), y830 = mark(), c831 = adder(), x832 = parsed();
  const b833 = box(), d834 = fraction(), s835 = narrow(), i836 = int(), e837 = either(), t838 = flag(), g839 = big(), l840 = large(), z841 = special(), w842 = wide(), r843 = rope(), p844 = slice(), k845 = point(), a846 = list(), y847 = mark(), c848 = adder(), x849 = parsed();
  const b850 = box(), d851 = fraction(), s852 = narrow(), i853 = int(), e854 = either(), t855 = flag(), g856 = big(), l857 = large(), z858 = special(), w859 = wide(), r860 = rope(), p861 = slice(), k862 = point(), a863 = list(), y864 = mark(), c865 = adder(), x866 = parsed();
  const b867 = box(), d868 = fraction(), s869 = narrow(), i870 = int(), e871 = either(), t872 = flag(), g873 = big(), l874 = large(), z875 = special(), w876 = wide(), r877 = rope(), p878 = slice(), k879 = point(), a880 = list(), y881 = mark(), c882 = adder(), x883 = parsed();
  const b884 = box(), d885 = fraction(), s886 = narrow(), i887 = int(), e888 = either(), t889 = flag(), g890 = big(), l891 = large(), z892 = special(), w893 = wide(), r894 = rope(), p895 = slice(), k896 = point(), a897 = list(), y898 = mark(), c899 = adder(), x900 = parsed();
  const b901 = box(), d902 = fraction(), s903 = narrow(), i904 = int(), e905 = either(), t906 = flag(), g907 = big(), l908 = large(), z909 = special(), w910 = wide(), r911 = rope(), p912 = slice(), k913 = point(), a914 = list(), y915 = mark(), c916 = adder(), x917 = parsed();
  const b918 = box(), d919 = fraction(), s920 = narrow(), i921 = int(), e922 = either(), t923 = flag(), g924 = big(), l925 = large(), z926 = special(), w927 = wide(), r928 = rope(), p929 = slice(), k930 = point(), a931 = list(), y932 = mark(), c933 = adder(), x934 = parsed();
  const b935 = box(), d936 = fraction(), s937 = narrow(), i938 = int(), e939 = either(), t940 = flag(), g941 = big(), l942 = large(), z943 = special(), w944 = wide(), r945 = rope(), p946 = slice(), k947 = point(), a948 = list(), y949 = mark(), c950 = adder(), x951 = parsed();
  const b952 = box(), d953 = fraction(), s954 = narrow(), i955 = int(), e956 = either(), t957 = flag(), g958 = big(), l959 = large(), z960 = special(), w961 = wide(), r962 = rope(), p963 = slice(), k964 = point(), a965 = list(), y966 = mark(), c967 = adder(), x968 = parsed();
  const b969 = box(), d970 = fraction(), s971 = narrow(), i972 = int(), e973 = either(), t974 = flag(), g975 = big(), l976 = large(), z977 = special(), w978 = wide(), r979 = rope(), p980 = slice(), k981 = point(), a982 = list(), y983 = mark(), c984 = adder(), x985 = parsed();
  const b986 = box(), d987 = fraction(), s988 = narrow(), i989 = int(), e990 = either(), t991 = flag(), g992 = big(), l993 = large(), z994 = special(), w995 = wide(), r996 = rope(), p997 = slice(), k998 = point(), a999 = list(), y1000 = mark(), c1001 = adder(), x1002 = parsed();
  const b1003 = box(), d1004 = fraction(), s1005 = narrow(), i1006 = int(), e1007 = either(), t1008 = flag(), g1009 = big(), l1010 = large(), z1011 = special(), w1012 = wide(), r1013 = rope(), p1014 = slice(), k1015 = point(), a1016 = list(), y1017 = mark(), c1018 = adder(), x1019 = parsed();
  const b1020 = box(), d1021 = fraction(), s1022 = narrow(), i1023 = int(), e1024 = either(), t1025 = flag(), g1026 = big(), l1027 = large(), z1028 = special(), w1029 = wide(), r1030 = rope(), p1031 = slice(), k1032 = point(), a1033 = list(), y1034 = mark(), c1035 = adder(), x1036 = parsed();
  const b1037 = box(), d1038 = fraction(), s1039 = narrow(), i1040 = int(), e1041 = either(), t1042 = flag(), g1043 = big(), l1044 = large(), z1045 = special(), w1046 = wide(), r1047 = rope(), p1048 = slice(), k1049 = point(), a1050 = list(), y1051 = mark(), c1052 = adder(), x1053 = parsed();
  const b1054 = box(), d1055 = fraction(), s1056 = narrow(), i1057 = int(), e1058 = either(), t1059 = flag(), g1060 = big(), l1061 = large(), z1062 = special(), w1063 = wide(), r1064 = rope(), p1065 = slice(), k1066 = point(), a1067 = list(), y1068 = mark(), c1069 = adder(), x1070 = parsed();
  const b1071 = box(), d1072 = fraction(), s1073 = narrow(), i1074 = int(), e1075 = either(), t1076 = flag(), g1077 = big(), l1078 = large(), z1079 = special(), w1080 = wide(), r1081 = rope(), p1082 = slice(), k1083 = point(), a1084 = list(), y1085 = mark(), c1086 = adder(), x1087 = parsed();
  const b1088 = box(), d1089 = fraction(), s1090 = narrow(), i1091 = int(), e1092 = either(), t1093 = flag(), g1094 = big(), l1095 = large(), z1096 = special(), w1097 = wide(), r1098 = rope(), p1099 = slice(), k1100 = point(), a1101 = list(), y1102 = mark(), c1103 = adder(), x1104 = parsed();
  const b1105 = box(), d1106 = fraction(), s1107 = narrow(), i1108 = int(), e1109 = either(), t1110 = flag(), g1111 = big(), l1112 = large(), z1113 = special(), w1114 = wide(), r1115 = rope(), p1116 = slice(), k1117 = point(), a1118 = list(), y1119 = mark(), c1120 = adder(), x1121 = parsed();
  const b1122 = box(), d1123 = fraction(), s1124 = narrow(), i1125 = int(), e1126 = either(), t1127 = flag(), g1128 = big(), l1129 = large(), z1130 = special(), w1131 = wide(), r1132 = rope(), p1133 = slice(), k1134 = point(), a1135 = list(), y1136 = mark(), c1137 = adder(), x1138 = parsed();
  const b1139 = box(), d1140 = fraction(), s1141 = narrow(), i1142 = int(), e1143 = either(), t1144 = flag(), g1145 = big(), l1146 = large(), z1147 = special(), w1148 = wide(), r1149 = rope(), p1150 = slice(), k1151 = point(), a1152 = list(), y1153 = mark(), c1154 = adder(), x1155 = parsed();
  const b1156 = box(), d1157 = fraction(), s1158 = narrow(), i1159 = int(), e1160 = either(), t1161 = flag(), g1162 = big(), l1163 = large(), z1164 = special(), w1165 = wide(), r1166 = rope(), p1167 = slice(), k1168 = point(), a1169 = list(), y1170 = mark(), c1171 = adder(), x1172 = parsed();
  const b1173 = box(), d1174 = fraction(), s1175 = narrow(), i1176 = int(), e1177 = either(), t1178 = flag(), g1179 = big(), l1180 = large(), z1181 = special(), w1182 = wide(), r1183 = rope(), p1184 = slice(), k1185 = point(), a1186 = list(), y1187 = mark(), c1188 = adder(), x1189 = parsed();
  const b1190 = box(), d1191 = fraction(), s1192 = narrow(), i1193 = int(), e1194 = either(), t1195 = flag(), g1196 = big(), l1197 = large(), z1198 = special(), w1199 = wide(), r1200 = rope(), p1201 = slice(), k1202 = point(), a1203 = list(), y1204 = mark(), c1205 = adder(), x1206 = parsed();
  const b1207 = box(), d1208 = fraction(), s1209 = narrow(), i1210 = int(), e1211 = either(), t1212 = flag(), g1213 = big(), l1214 = large(), z1215 = special(), w1216 = wide(), r1217 = rope(), p1218 = slice(), k1219 = point(), a1220 = list(), y1221 = mark(), c1222 = adder(), x1223 = parsed();
  const b1224 = box(), d1225 = fraction(), s1226 = narrow(), i1227 = int(), e1228 = either(), t1229 = flag(), g1230 = big(), l1231 = large(), z1232 = special(), w1233 = wide(), r1234 = rope(), p1235 = slice(), k1236 = point(), a1237 = list(), y1238 = mark(), c1239 = adder(), x1240 = parsed();
  const b1241 = box(), d1242 = fraction(), s1243 = narrow(), i1244 = int(), e1245 = either(), t1246 = flag(), g1247 = big(), l1248 = large(), z1249 = special(), w1250 = wide(), r1251 = rope(), p1252 = slice(), k1253 = point(), a1254 = list(), y1255 = mark(), c1256 = adder(), x1257 = parsed();
  const b1258 = box(), d1259 = fraction(), s1260 = narrow(), i1261 = int(), e1262 = either(), t1263 = flag(), g1264 = big(), l1265 = large(), z1266 = special(), w1267 = wide(), r1268 = rope(), p1269 = slice(), k1270 = point(), a1271 = list(), y1272 = mark(), c1273 = adder(), x1274 = parsed();
  const b1275 = box(), d1276 = fraction(), s1277 = narrow(), i1278 = int(), e1279 = either(), t1280 = flag(), g1281 = big(), l1282 = large(), z1283 = special(), w1284 = wide(), r1285 = rope(), p1286 = slice(), k1287 = point(), a1288 = list(), y1289 = mark(), c1290 = adder(), x1291 = parsed();
  const b1292 = box(), d1293 = fraction(), s1294 = narrow(), i1295 = int(), e1296 = either(), t1297 = flag(), g1298 = big(), l1299 = large(), z1300 = special(), w1301 = wide(), r1302 = rope(), p1303 = slice(), k1304 = point(), a1305 = list(), y1306 = mark(), c1307 = adder(), x1308 = parsed();
  const b1309 = box(), d1310 = fraction(), s1311 = narrow(), i1312 = int(), e1313 = either(), t1314 = flag(), g1315 = big(), l1316 = large(), z1317 = special(), w1318 = wide(), r1319 = rope(), p1320 = slice(), k1321 = point(), a1322 = list(), y1323 = mark(), c1324 = adder(), x1325 = parsed();
  const b1326 = box(), d1327 = fraction(), s1328 = narrow(), i1329 = int(), e1330 = either(), t1331 = flag(), g1332 = big(), l1333 = large(), z1334 = special(), w1335 = wide(), r1336 = rope(), p1337 = slice(), k1338 = point(), a1339 = list(), y1340 = mark(), c1341 = adder(), x1342 = parsed();
  const b1343 = box(), d1344 = fraction(), s1345 = narrow(), i1346 = int(), e1347 = either(), t1348 = flag(), g1349 = big(), l1350 = large(), z1351 = special(), w1352 = wide(), r1353 = rope(), p1354 = slice(), k1355 = point(), a1356 = list(), y1357 = mark(), c1358 = adder(), x1359 = parsed();
  const b1360 = box(), d1361 = fraction(), s1362 = narrow(), i1363 = int(), e1364 = either(), t1365 = flag(), g1366 = big(), l1367 = large(), z1368 = special(), w1369 = wide(), r1370 = rope(), p1371 = slice(), k1372 = point(), a1373 = list(), y1374 = mark(), c1375 = adder(), x1376 = parsed();
  const b1377 = box(), d1378 = fraction(), s1379 = narrow(), i1380 = int(), e1381 = either(), t1382 = flag(), g1383 = big(), l1384 = large(), z1385 = special(), w1386 = wide(), r1387 = rope(), p1388 = slice(), k1389 = point(), a1390 = list(), y1391 = mark(), c1392 = adder(), x1393 = parsed();
  const b1394 = box(), d1395 = fraction(), s1396 = narrow(), i1397 = int(), e1398 = either(), t1399 = flag(), g1400 = big(), l1401 = large(), z1402 = special(), w1403 = wide(), r1404 = rope(), p1405 = slice(), k1406 = point(), a1407 = list(), y1408 = mark(), c1409 = adder(), x1410 = parsed();
  const b1411 = box(), d1412 = fraction(), s1413 = narrow(), i1414 = int(), e1415 = either(), t1416 = flag(), g1417 = big(), l1418 = large(), z1419 = special(), w1420 = wide(), r1421 = rope(), p1422 = slice(), k1423 = point(), a1424 = list(), y1425 = mark(), c1426 = adder(), x1427 = parsed();
  const b1428 = box(), d1429 = fraction(), s1430 = narrow(), i1431 = int(), e1432 = either(), t1433 = flag(), g1434 = big(), l1435 = large(), z1436 = special(), w1437 = wide(), r1438 = rope(), p1439 = slice(), k1440 = point(), a1441 = list(), y1442 = mark(), c1443 = adder(), x1444 = parsed();
  const b1445 = box(), d1446 = fraction(), s1447 = narrow(), i1448 = int(), e1449 = either(), t1450 = flag(), g1451 = big(), l1452 = large(), z1453 = special(), w1454 = wide(), r1455 = rope(), p1456 = slice(), k1457 = point(), a1458 = list(), y1459 = mark(), c1460 = adder(), x1461 = parsed();
  const b1462 = box(), d1463 = fraction(), s1464 = narrow(), i1465 = int(), e1466 = either(), t1467 = flag(), g1468 = big(), l1469 = large(), z1470 = special(), w1471 = wide(), r1472 = rope(), p1473 = slice(), k1474 = point(), a1475 = list(), y1476 = mark(), c1477 = adder(), x1478 = parsed();
  const b1479 = box(), d1480 = fraction(), s1481 = narrow(), i1482 = int(), e1483 = either(), t1484 = flag(), g1485 = big(), l1486 = large(), z1487 = special(), w1488 = wide(), r1489 = rope(), p1490 = slice(), k1491 = point(), a1492 = list(), y1493 = mark(), c1494 = adder(), x1495 = parsed();
  const b1496 = box(), d1497 = fraction(), s1498 = narrow(), i1499 = int(), e1500 = either(), t1501 = flag(), g1502 = big(), l1503 = large(), z1504 = special(), w1505 = wide(), r1506 = rope(), p1507 = slice(), k1508 = point(), a1509 = list(), y1510 = mark(), c1511 = adder(), x1512 = parsed();
  const b1513 = box(), d1514 = fraction(), s1515 = narrow(), i1516 = int(), e1517 = either(), t1518 = flag(), g1519 = big(), l1520 = large(), z1521 = special(), w1522 = wide(), r1523 = rope(), p1524 = slice(), k1525 = point(), a1526 = list(), y1527 = mark(), c1528 = adder(), x1529 = parsed();
  const b1530 = box(), d1531 = fraction(), s1532 = narrow(), i1533 = int(), e1534 = either(), t1535 = flag(), g1536 = big(), l1537 = large(), z1538 = special(), w1539 = wide(), r1540 = rope(), p1541 = slice(), k1542 = point(), a1543 = list(), y1544 = mark(), c1545 = adder(), x1546 = parsed();
  const b1547 = box(), d1548 = fraction(), s1549 = narrow(), i1550 = int(), e1551 = either(), t1552 = flag(), g1553 = big(), l1554 = large(), z1555 = special(), w1556 = wide(), r1557 = rope(), p1558 = slice(), k1559 = point(), a1560 = list(), y1561 = mark(), c1562 = adder(), x1563 = parsed();
  const b1564 = box(), d1565 = fraction(), s1566 = narrow(), i1567 = int(), e1568 = either(), t1569 = flag(), g1570 = big(), l1571 = large(), z1572 = special(), w1573 = wide(), r1574 = rope(), p1575 = slice(), k1576 = point(), a1577 = list(), y1578 = mark(), c1579 = adder(), x1580 = parsed();
  const b1581 = box(), d1582 = fraction(), s1583 = narrow(), i1584 = int(), e1585 = either(), t1586 = flag(), g1587 = big(), l1588 = large(), z1589 = special(), w1590 = wide(), r1591 = rope(), p1592 = slice(), k1593 = point(), a1594 = list(), y1595 = mark(), c1596 = adder(), x1597 = parsed();
  const b1598 = box(), d1599 = fraction(), s1600 = narrow(), i1601 = int(), e1602 = either(), t1603 = flag(), g1604 = big(), l1605 = large(), z1606 = special(), w1607 = wide(), r1608 = rope(), p1609 = slice(), k1610 = point(), a1611 = list(), y1612 = mark(), c1613 = adder(), x1614 = parsed();
  const b1615 = box(), d1616 = fraction(), s1617 = narrow(), i1618 = int(), e1619 = either(), t1620 = flag(), g1621 = big(), l1622 = large(), z1623 = special(), w1624 = wide(), r1625 = rope(), p1626 = slice(), k1627 = point(), a1628 = list(), y1629 = mark(), c1630 = adder(), x1631 = parsed();
  const b1632 = box(), d1633 = fraction(), s1634 = narrow(), i1635 = int(), e1636 = either(), t1637 = flag(), g1638 = big(), l1639 = large(), z1640 = special(), w1641 = wide(), r1642 = rope(), p1643 = slice(), k1644 = point(), a1645 = list(), y1646 = mark(), c1647 = adder(), x1648 = parsed();
  const b1649 = box(), d1650 = fraction(), s1651 = narrow(), i1652 = int(), e1653 = either(), t1654 = flag(), g1655 = big(), l1656 = large(), z1657 = special(), w1658 = wide(), r1659 = rope(), p1660 = slice(), k1661 = point(), a1662 = list(), y1663 = mark(), c1664 = adder(), x1665 = parsed();
  const b1666 = box(), d1667 = fraction(), s1668 = narrow(), i1669 = int(), e1670 = either(), t1671 = flag(), g1672 = big(), l1673 = large(), z1674 = special(), w1675 = wide(), r1676 = rope(), p1677 = slice(), k1678 = point(), a1679 = list(), y1680 = mark(), c1681 = adder(), x1682 = parsed();
  const b1683 = box(), d1684 = fraction(), s1685 = narrow(), i1686 = int(), e1687 = either(), t1688 = flag(), g1689 = big(), l1690 = large(), z1691 = special(), w1692 = wide(), r1693 = rope(), p1694 = slice(), k1695 = point(), a1696 = list(), y1697 = mark(), c1698 = adder(), x1699 = parsed();
  const b1700 = box(), d1701 = fraction(), s1702 = narrow(), i1703 = int(), e1704 = either(), t1705 = flag(), g1706 = big(), l1707 = large(), z1708 = special(), w1709 = wide(), r1710 = rope(), p1711 = slice(), k1712 = point(), a1713 = list(), y1714 = mark(), c1715 = adder(), x1716 = parsed();
  const b1717 = box(), d1718 = fraction(), s1719 = narrow(), i1720 = int(), e1721 = either(), t1722 = flag(), g1723 = big(), l1724 = large(), z1725 = special(), w1726 = wide(), r1727 = rope(), p1728 = slice(), k1729 = point(), a1730 = list(), y1731 = mark(), c1732 = adder(), x1733 = parsed();
  const b1734 = box(), d1735 = fraction(), s1736 = narrow(), i1737 = int(), e1738 = either(), t1739 = flag(), g1740 = big(), l1741 = large(), z1742 = special(), w1743 = wide(), r1744 = rope(), p1745 = slice(), k1746 = point(), a1747 = list(), y1748 = mark(), c1749 = adder(), x1750 = parsed();
  const b1751 = box(), d1752 = fraction(), s1753 = narrow(), i1754 = int(), e1755 = either(), t1756 = flag(), g1757 = big(), l1758 = large(), z1759 = special(), w1760 = wide(), r1761 = rope(), p1762 = slice(), k1763 = point(), a1764 = list(), y1765 = mark(), c1766 = adder(), x1767 = parsed();
  const b1768 = box(), d1769 = fraction(), s1770 = narrow(), i1771 = int(), e1772 = either(), t1773 = flag(), g1774 = big(), l1775 = large(), z1776 = special(), w1777 = wide(), r1778 = rope(), p1779 = slice(), k1780 = point(), a1781 = list(), y1782 = mark(), c1783 = adder(), x1784 = parsed();
  const b1785 = box(), d1786 = fraction(), s1787 = narrow(), i1788 = int(), e1789 = either(), t1790 = flag(), g1791 = big(), l1792 = large(), z1793 = special(), w1794 = wide(), r1795 = rope(), p1796 = slice(), k1797 = point(), a1798 = list(), y1799 = mark(), c1800 = adder(), x1801 = parsed();
  const b1802 = box(), d1803 = fraction(), s1804 = narrow(), i1805 = int(), e1806 = either(), t1807 = flag(), g1808 = big(), l1809 = large(), z1810 = special(), w1811 = wide(), r1812 = rope(), p1813 = slice(), k1814 = point(), a1815 = list(), y1816 = mark(), c1817 = adder(), x1818 = parsed();
  const b1819 = box(), d1820 = fraction(), s1821 = narrow(), i1822 = int(), e1823 = either(), t1824 = flag(), g1825 = big(), l1826 = large(), z1827 = special(), w1828 = wide(), r1829 = rope(), p1830 = slice(), k1831 = point(), a1832 = list(), y1833 = mark(), c1834 = adder(), x1835 = parsed();
  const b1836 = box(), d1837 = fraction(), s1838 = narrow(), i1839 = int(), e1840 = either(), t1841 = flag(), g1842 = big(), l1843 = large(), z1844 = special(), w1845 = wide(), r1846 = rope(), p1847 = slice(), k1848 = point(), a1849 = list(), y1850 = mark(), c1851 = adder(), x1852 = parsed();
  const b1853 = box(), d1854 = fraction(), s1855 = narrow(), i1856 = int(), e1857 = either(), t1858 = flag(), g1859 = big(), l1860 = large(), z1861 = special(), w1862 = wide(), r1863 = rope(), p1864 = slice(), k1865 = point(), a1866 = list(), y1867 = mark(), c1868 = adder(), x1869 = parsed();
  const b1870 = box(), d1871 = fraction(), s1872 = narrow(), i1873 = int(), e1874 = either(), t1875 = flag(), g1876 = big(), l1877 = large(), z1878 = special(), w1879 = wide(), r1880 = rope(), p1881 = slice(), k1882 = point(), a1883 = list(), y1884 = mark(), c1885 = adder(), x1886 = parsed();
  const b1887 = box(), d1888 = fraction(), s1889 = narrow(), i1890 = int(), e1891 = either(), t1892 = flag(), g1893 = big(), l1894 = large(), z1895 = special(), w1896 = wide(), r1897 = rope(), p1898 = slice(), k1899 = point(), a1900 = list(), y1901 = mark(), c1902 = adder(), x1903 = parsed();
  const b1904 = box(), d1905 = fraction(), s1906 = narrow(), i1907 = int(), e1908 = either(), t1909 = flag(), g1910 = big(), l1911 = large(), z1912 = special(), w1913 = wide(), r1914 = rope(), p1915 = slice(), k1916 = point(), a1917 = list(), y1918 = mark(), c1919 = adder(), x1920 = parsed();
  const b1921 = box(), d1922 = fraction(), s1923 = narrow(), i1924 = int(), e1925 = either(), t1926 = flag(), g1927 = big(), l1928 = large(), z1929 = special(), w1930 = wide(), r1931 = rope(), p1932 = slice(), k1933 = point(), a1934 = list(), y1935 = mark(), c1936 = adder(), x1937 = parsed();
  const b1938 = box(), d1939 = fraction(), s1940 = narrow(), i1941 = int(), e1942 = either(), t1943 = flag(), g1944 = big(), l1945 = large(), z1946 = special(), w1947 = wide(), r1948 = rope(), p1949 = slice(), k1950 = point(), a1951 = list(), y1952 = mark(), c1953 = adder(), x1954 = parsed();
  const b1955 = box(), d1956 = fraction(), s1957 = narrow(), i1958 = int(), e1959 = either(), t1960 = flag(), g1961 = big(), l1962 = large(), z1963 = special(), w1964 = wide(), r1965 = rope(), p1966 = slice(), k1967 = point(), a1968 = list(), y1969 = mark(), c1970 = adder(), x1971 = parsed();
  const b1972 = box(), d1973 = fraction(), s1974 = narrow(), i1975 = int(), e1976 = either(), t1977 = flag(), g1978 = big(), l1979 = large(), z1980 = special(), w1981 = wide(), r1982 = rope(), p1983 = slice(), k1984 = point(), a1985 = list(), y1986 = mark(), c1987 = adder(), x1988 = parsed();
  const b1989 = box(), d1990 = fraction(), s1991 = narrow(), i1992 = int(), e1993 = either(), t1994 = flag(), g1995 = big(), l1996 = large(), z1997 = special(), w1998 = wide(), r1999 = rope();
  let h = yield seed;
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = fold(h, b289, d290, s291, i292, e293, t294, g295, l296, z297, w298, r299, p300, k301, a302, y303, c304, x305);
  h = fold(h, b306, d307, s308, i309, e310, t311, g312, l313, z314, w315, r316, p317, k318, a319, y320, c321, x322);
  h = fold(h, b323, d324, s325, i326, e327, t328, g329, l330, z331, w332, r333, p334, k335, a336, y337, c338, x339);
  h = fold(h, b340, d341, s342, i343, e344, t345, g346, l347, z348, w349, r350, p351, k352, a353, y354, c355, x356);
  h = fold(h, b357, d358, s359, i360, e361, t362, g363, l364, z365, w366, r367, p368, k369, a370, y371, c372, x373);
  h = fold(h, b374, d375, s376, i377, e378, t379, g380, l381, z382, w383, r384, p385, k386, a387, y388, c389, x390);
  h = fold(h, b391, d392, s393, i394, e395, t396, g397, l398, z399, w400, r401, p402, k403, a404, y405, c406, x407);
  h = fold(h, b408, d409, s410, i411, e412, t413, g414, l415, z416, w417, r418, p419, k420, a421, y422, c423, x424);
  h = fold(h, b425, d426, s427, i428, e429, t430, g431, l432, z433, w434, r435, p436, k437, a438, y439, c440, x441);
  h = fold(h, b442, d443, s444, i445, e446, t447, g448, l449, z450, w451, r452, p453, k454, a455, y456, c457, x458);
  h = fold(h, b459, d460, s461, i462, e463, t464, g465, l466, z467, w468, r469, p470, k471, a472, y473, c474, x475);
  h = fold(h, b476, d477, s478, i479, e480, t481, g482, l483, z484, w485, r486, p487, k488, a489, y490, c491, x492);
  h = fold(h, b493, d494, s495, i496, e497, t498, g499, l500, z501, w502, r503, p504, k505, a506, y507, c508, x509);
  h = fold(h, b510, d511, s512, i513, e514, t515, g516, l517, z518, w519, r520, p521, k522, a523, y524, c525, x526);
  h = fold(h, b527, d528, s529, i530, e531, t532, g533, l534, z535, w536, r537, p538, k539, a540, y541, c542, x543);
  h = fold(h, b544, d545, s546, i547, e548, t549, g550, l551, z552, w553, r554, p555, k556, a557, y558, c559, x560);
  h = fold(h, b561, d562, s563, i564, e565, t566, g567, l568, z569, w570, r571, p572, k573, a574, y575, c576, x577);
  h = fold(h, b578, d579, s580, i581, e582, t583, g584, l585, z586, w587, r588, p589, k590, a591, y592, c593, x594);
  h = fold(h, b595, d596, s597, i598, e599, t600, g601, l602, z603, w604, r605, p606, k607, a608, y609, c610, x611);
  h = fold(h, b612, d613, s614, i615, e616, t617, g618, l619, z620, w621, r622, p623, k624, a625, y626, c627, x628);
  h = fold(h, b629, d630, s631, i632, e633, t634, g635, l636, z637, w638, r639, p640, k641, a642, y643, c644, x645);
  h = fold(h, b646, d647, s648, i649, e650, t651, g652, l653, z654, w655, r656, p657, k658, a659, y660, c661, x662);
  h = fold(h, b663, d664, s665, i666, e667, t668, g669, l670, z671, w672, r673, p674, k675, a676, y677, c678, x679);
  h = fold(h, b680, d681, s682, i683, e684, t685, g686, l687, z688, w689, r690, p691, k692, a693, y694, c695, x696);
  h = fold(h, b697, d698, s699, i700, e701, t702, g703, l704, z705, w706, r707, p708, k709, a710, y711, c712, x713);
  h = fold(h, b714, d715, s716, i717, e718, t719, g720, l721, z722, w723, r724, p725, k726, a727, y728, c729, x730);
  h = fold(h, b731, d732, s733, i734, e735, t736, g737, l738, z739, w740, r741, p742, k743, a744, y745, c746, x747);
  h = fold(h, b748, d749, s750, i751, e752, t753, g754, l755, z756, w757, r758, p759, k760, a761, y762, c763, x764);
  h = fold(h, b765, d766, s767, i768, e769, t770, g771, l772, z773, w774, r775, p776, k777, a778, y779, c780, x781);
  h = fold(h, b782, d783, s784, i785, e786, t787, g788, l789, z790, w791, r792, p793, k794, a795, y796, c797, x798);
  h = fold(h, b799, d800, s801, i802, e803, t804, g805, l806, z807, w808, r809, p810, k811, a812, y813, c814, x815);
  h = fold(h, b816, d817, s818, i819, e820, t821, g822, l823, z824, w825, r826, p827, k828, a829, y830, c831, x832);
  h = fold(h, b833, d834, s835, i836, e837, t838, g839, l840, z841, w842, r843, p844, k845, a846, y847, c848, x849);
  h = fold(h, b850, d851, s852, i853, e854, t855, g856, l857, z858, w859, r860, p861, k862, a863, y864, c865, x866);
  h = fold(h, b867, d868, s869, i870, e871, t872, g873, l874, z875, w876, r877, p878, k879, a880, y881, c882, x883);
  h = fold(h, b884, d885, s886, i887, e888, t889, g890, l891, z892, w893, r894, p895, k896, a897, y898, c899, x900);
  h = fold(h, b901, d902, s903, i904, e905, t906, g907, l908, z909, w910, r911, p912, k913, a914, y915, c916, x917);
  h = fold(h, b918, d919, s920, i921, e922, t923, g924, l925, z926, w927, r928, p929, k930, a931, y932, c933, x934);
  h = fold(h, b935, d936, s937, i938, e939, t940, g941, l942, z943, w944, r945, p946, k947, a948, y949, c950, x951);
  h = fold(h, b952, d953, s954, i955, e956, t957, g958, l959, z960, w961, r962, p963, k964, a965, y966, c967, x968);
  h = fold(h, b969, d970, s971, i972, e973, t974, g975, l976, z977, w978, r979, p980, k981, a982, y983, c984, x985);
  h = fold(h, b986, d987, s988, i989, e990, t991, g992, l993, z994, w995, r996, p997, k998, a999, y1000, c1001, x1002);
  h = fold(h, b1003, d1004, s1005, i1006, e1007, t1008, g1009, l1010, z1011, w1012, r1013, p1014, k1015, a1016, y1017, c1018, x1019);
  h = fold(h, b1020, d1021, s1022, i1023, e1024, t1025, g1026, l1027, z1028, w1029, r1030, p1031, k1032, a1033, y1034, c1035, x1036);
  h = fold(h, b1037, d1038, s1039, i1040, e1041, t1042, g1043, l1044, z1045, w1046, r1047, p1048, k1049, a1050, y1051, c1052, x1053);
  h = fold(h, b1054, d1055, s1056, i1057, e1058, t1059, g1060, l1061, z1062, w1063, r1064, p1065, k1066, a1067, y1068, c1069, x1070);
  h = fold(h, b1071, d1072, s1073, i1074, e1075, t1076, g1077, l1078, z1079, w1080, r1081, p1082, k1083, a1084, y1085, c1086, x1087);
  h = fold(h, b1088, d1089, s1090, i1091, e1092, t1093, g1094, l1095, z1096, w1097, r1098, p1099, k1100, a1101, y1102, c1103, x1104);
  h = fold(h, b1105, d1106, s1107, i1108, e1109, t1110, g1111, l1112, z1113, w1114, r1115, p1116, k1117, a1118, y1119, c1120, x1121);
  h = fold(h, b1122, d1123, s1124, i1125, e1126, t1127, g1128, l1129, z1130, w1131, r1132, p1133, k1134, a1135, y1136, c1137, x1138);
  h = fold(h, b1139, d1140, s1141, i1142, e1143, t1144, g1145, l1146, z1147, w1148, r1149, p1150, k1151, a1152, y1153, c1154, x1155);
  h = fold(h, b1156, d1157, s1158, i1159, e1160, t1161, g1162, l1163, z1164, w1165, r1166, p1167, k1168, a1169, y1170, c1171, x1172);
  h = fold(h, b1173, d1174, s1175, i1176, e1177, t1178, g1179, l1180, z1181, w1182, r1183, p1184, k1185, a1186, y1187, c1188, x1189);
  h = fold(h, b1190, d1191, s1192, i1193, e1194, t1195, g1196, l1197, z1198, w1199, r1200, p1201, k1202, a1203, y1204, c1205, x1206);
  h = fold(h, b1207, d1208, s1209, i1210, e1211, t1212, g1213, l1214, z1215, w1216, r1217, p1218, k1219, a1220, y1221, c1222, x1223);
  h = fold(h, b1224, d1225, s1226, i1227, e1228, t1229, g1230, l1231, z1232, w1233, r1234, p1235, k1236, a1237, y1238, c1239, x1240);
  h = fold(h, b1241, d1242, s1243, i1244, e1245, t1246, g1247, l1248, z1249, w1250, r1251, p1252, k1253, a1254, y1255, c1256, x1257);
  h = fold(h, b1258, d1259, s1260, i1261, e1262, t1263, g1264, l1265, z1266, w1267, r1268, p1269, k1270, a1271, y1272, c1273, x1274);
  h = fold(h, b1275, d1276, s1277, i1278, e1279, t1280, g1281, l1282, z1283, w1284, r1285, p1286, k1287, a1288, y1289, c1290, x1291);
  h = fold(h, b1292, d1293, s1294, i1295, e1296, t1297, g1298, l1299, z1300, w1301, r1302, p1303, k1304, a1305, y1306, c1307, x1308);
  h = fold(h, b1309, d1310, s1311, i1312, e1313, t1314, g1315, l1316, z1317, w1318, r1319, p1320, k1321, a1322, y1323, c1324, x1325);
  h = fold(h, b1326, d1327, s1328, i1329, e1330, t1331, g1332, l1333, z1334, w1335, r1336, p1337, k1338, a1339, y1340, c1341, x1342);
  h = fold(h, b1343, d1344, s1345, i1346, e1347, t1348, g1349, l1350, z1351, w1352, r1353, p1354, k1355, a1356, y1357, c1358, x1359);
  h = fold(h, b1360, d1361, s1362, i1363, e1364, t1365, g1366, l1367, z1368, w1369, r1370, p1371, k1372, a1373, y1374, c1375, x1376);
  h = fold(h, b1377, d1378, s1379, i1380, e1381, t1382, g1383, l1384, z1385, w1386, r1387, p1388, k1389, a1390, y1391, c1392, x1393);
  h = fold(h, b1394, d1395, s1396, i1397, e1398, t1399, g1400, l1401, z1402, w1403, r1404, p1405, k1406, a1407, y1408, c1409, x1410);
  h = fold(h, b1411, d1412, s1413, i1414, e1415, t1416, g1417, l1418, z1419, w1420, r1421, p1422, k1423, a1424, y1425, c1426, x1427);
  h = fold(h, b1428, d1429, s1430, i1431, e1432, t1433, g1434, l1435, z1436, w1437, r1438, p1439, k1440, a1441, y1442, c1443, x1444);
  h = fold(h, b1445, d1446, s1447, i1448, e1449, t1450, g1451, l1452, z1453, w1454, r1455, p1456, k1457, a1458, y1459, c1460, x1461);
  h = fold(h, b1462, d1463, s1464, i1465, e1466, t1467, g1468, l1469, z1470, w1471, r1472, p1473, k1474, a1475, y1476, c1477, x1478);
  h = fold(h, b1479, d1480, s1481, i1482, e1483, t1484, g1485, l1486, z1487, w1488, r1489, p1490, k1491, a1492, y1493, c1494, x1495);
  h = fold(h, b1496, d1497, s1498, i1499, e1500, t1501, g1502, l1503, z1504, w1505, r1506, p1507, k1508, a1509, y1510, c1511, x1512);
  h = fold(h, b1513, d1514, s1515, i1516, e1517, t1518, g1519, l1520, z1521, w1522, r1523, p1524, k1525, a1526, y1527, c1528, x1529);
  h = fold(h, b1530, d1531, s1532, i1533, e1534, t1535, g1536, l1537, z1538, w1539, r1540, p1541, k1542, a1543, y1544, c1545, x1546);
  h = fold(h, b1547, d1548, s1549, i1550, e1551, t1552, g1553, l1554, z1555, w1556, r1557, p1558, k1559, a1560, y1561, c1562, x1563);
  h = fold(h, b1564, d1565, s1566, i1567, e1568, t1569, g1570, l1571, z1572, w1573, r1574, p1575, k1576, a1577, y1578, c1579, x1580);
  h = fold(h, b1581, d1582, s1583, i1584, e1585, t1586, g1587, l1588, z1589, w1590, r1591, p1592, k1593, a1594, y1595, c1596, x1597);
  h = fold(h, b1598, d1599, s1600, i1601, e1602, t1603, g1604, l1605, z1606, w1607, r1608, p1609, k1610, a1611, y1612, c1613, x1614);
  h = fold(h, b1615, d1616, s1617, i1618, e1619, t1620, g1621, l1622, z1623, w1624, r1625, p1626, k1627, a1628, y1629, c1630, x1631);
  h = fold(h, b1632, d1633, s1634, i1635, e1636, t1637, g1638, l1639, z1640, w1641, r1642, p1643, k1644, a1645, y1646, c1647, x1648);
  h = fold(h, b1649, d1650, s1651, i1652, e1653, t1654, g1655, l1656, z1657, w1658, r1659, p1660, k1661, a1662, y1663, c1664, x1665);
  h = fold(h, b1666, d1667, s1668, i1669, e1670, t1671, g1672, l1673, z1674, w1675, r1676, p1677, k1678, a1679, y1680, c1681, x1682);
  h = fold(h, b1683, d1684, s1685, i1686, e1687, t1688, g1689, l1690, z1691, w1692, r1693, p1694, k1695, a1696, y1697, c1698, x1699);
  h = fold(h, b1700, d1701, s1702, i1703, e1704, t1705, g1706, l1707, z1708, w1709, r1710, p1711, k1712, a1713, y1714, c1715, x1716);
  h = fold(h, b1717, d1718, s1719, i1720, e1721, t1722, g1723, l1724, z1725, w1726, r1727, p1728, k1729, a1730, y1731, c1732, x1733);
  h = fold(h, b1734, d1735, s1736, i1737, e1738, t1739, g1740, l1741, z1742, w1743, r1744, p1745, k1746, a1747, y1748, c1749, x1750);
  h = fold(h, b1751, d1752, s1753, i1754, e1755, t1756, g1757, l1758, z1759, w1760, r1761, p1762, k1763, a1764, y1765, c1766, x1767);
  h = fold(h, b1768, d1769, s1770, i1771, e1772, t1773, g1774, l1775, z1776, w1777, r1778, p1779, k1780, a1781, y1782, c1783, x1784);
  h = fold(h, b1785, d1786, s1787, i1788, e1789, t1790, g1791, l1792, z1793, w1794, r1795, p1796, k1797, a1798, y1799, c1800, x1801);
  h = fold(h, b1802, d1803, s1804, i1805, e1806, t1807, g1808, l1809, z1810, w1811, r1812, p1813, k1814, a1815, y1816, c1817, x1818);
  h = fold(h, b1819, d1820, s1821, i1822, e1823, t1824, g1825, l1826, z1827, w1828, r1829, p1830, k1831, a1832, y1833, c1834, x1835);
  h = fold(h, b1836, d1837, s1838, i1839, e1840, t1841, g1842, l1843, z1844, w1845, r1846, p1847, k1848, a1849, y1850, c1851, x1852);
  h = fold(h, b1853, d1854, s1855, i1856, e1857, t1858, g1859, l1860, z1861, w1862, r1863, p1864, k1865, a1866, y1867, c1868, x1869);
  h = fold(h, b1870, d1871, s1872, i1873, e1874, t1875, g1876, l1877, z1878, w1879, r1880, p1881, k1882, a1883, y1884, c1885, x1886);
  h = fold(h, b1887, d1888, s1889, i1890, e1891, t1892, g1893, l1894, z1895, w1896, r1897, p1898, k1899, a1900, y1901, c1902, x1903);
  h = fold(h, b1904, d1905, s1906, i1907, e1908, t1909, g1910, l1911, z1912, w1913, r1914, p1915, k1916, a1917, y1918, c1919, x1920);
  h = fold(h, b1921, d1922, s1923, i1924, e1925, t1926, g1927, l1928, z1929, w1930, r1931, p1932, k1933, a1934, y1935, c1936, x1937);
  h = fold(h, b1938, d1939, s1940, i1941, e1942, t1943, g1944, l1945, z1946, w1947, r1948, p1949, k1950, a1951, y1952, c1953, x1954);
  h = fold(h, b1955, d1956, s1957, i1958, e1959, t1960, g1961, l1962, z1963, w1964, r1965, p1966, k1967, a1968, y1969, c1970, x1971);
  h = fold(h, b1972, d1973, s1974, i1975, e1976, t1977, g1978, l1979, z1980, w1981, r1982, p1983, k1984, a1985, y1986, c1987, x1988);
  h = ofBox(h, b1989); h = ofNumber(h, d1990); h = ofText(h, s1991); h = ofNumber(h, i1992); h = ofEither(h, e1993); h = ofFlag(h, t1994); h = ofBig(h, g1995); h = ofNumber(h, l1996); h = ofNumber(h, z1997); h = ofText(h, w1998); h = ofText(h, r1999);
  return h;
}

function* takesAndYields1(seed: number, collects: boolean, b0: Box): Steps {
  let h = yield seed;
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
function* takesAndYields7(seed: number, collects: boolean, b0: Box, d1: number, s2: string, i3: number, e4: Either, t5: boolean, g6: bigint): Steps {
  let h = yield seed;
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
function* takesAndYields40(seed: number, collects: boolean, b0: Box, d1: number, s2: string, i3: number, e4: Either, t5: boolean, g6: bigint, l7: number, z8: number, w9: string, r10: string, p11: string, k12: Point, a13: number[], y14: symbol, c15: Adds, x16: any, b17: Box, d18: number, s19: string, i20: number, e21: Either, t22: boolean, g23: bigint, l24: number, z25: number, w26: string, r27: string, p28: string, k29: Point, a30: number[], y31: symbol, c32: Adds, x33: any, b34: Box, d35: number, s36: string, i37: number, e38: Either, t39: boolean): Steps {
  let h = yield seed;
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}

async function* streams0(gate: Promise<number>, collects: boolean): StepsLater {
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  return h;
}
async function* streams1(gate: Promise<number>, collects: boolean): StepsLater {
  const b0 = box();
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
async function* streams7(gate: Promise<number>, collects: boolean): StepsLater {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function* streams40(gate: Promise<number>, collects: boolean): StepsLater {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}
async function* streams300(gate: Promise<number>, collects: boolean): StepsLater {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope();
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = ofBox(h, b289); h = ofNumber(h, d290); h = ofText(h, s291); h = ofNumber(h, i292); h = ofEither(h, e293); h = ofFlag(h, t294); h = ofBig(h, g295); h = ofNumber(h, l296); h = ofNumber(h, z297); h = ofText(h, w298); h = ofText(h, r299);
  return h;
}
async function* streams2000(gate: Promise<number>, collects: boolean): StepsLater {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag(), g40 = big(), l41 = large(), z42 = special(), w43 = wide(), r44 = rope(), p45 = slice(), k46 = point(), a47 = list(), y48 = mark(), c49 = adder(), x50 = parsed();
  const b51 = box(), d52 = fraction(), s53 = narrow(), i54 = int(), e55 = either(), t56 = flag(), g57 = big(), l58 = large(), z59 = special(), w60 = wide(), r61 = rope(), p62 = slice(), k63 = point(), a64 = list(), y65 = mark(), c66 = adder(), x67 = parsed();
  const b68 = box(), d69 = fraction(), s70 = narrow(), i71 = int(), e72 = either(), t73 = flag(), g74 = big(), l75 = large(), z76 = special(), w77 = wide(), r78 = rope(), p79 = slice(), k80 = point(), a81 = list(), y82 = mark(), c83 = adder(), x84 = parsed();
  const b85 = box(), d86 = fraction(), s87 = narrow(), i88 = int(), e89 = either(), t90 = flag(), g91 = big(), l92 = large(), z93 = special(), w94 = wide(), r95 = rope(), p96 = slice(), k97 = point(), a98 = list(), y99 = mark(), c100 = adder(), x101 = parsed();
  const b102 = box(), d103 = fraction(), s104 = narrow(), i105 = int(), e106 = either(), t107 = flag(), g108 = big(), l109 = large(), z110 = special(), w111 = wide(), r112 = rope(), p113 = slice(), k114 = point(), a115 = list(), y116 = mark(), c117 = adder(), x118 = parsed();
  const b119 = box(), d120 = fraction(), s121 = narrow(), i122 = int(), e123 = either(), t124 = flag(), g125 = big(), l126 = large(), z127 = special(), w128 = wide(), r129 = rope(), p130 = slice(), k131 = point(), a132 = list(), y133 = mark(), c134 = adder(), x135 = parsed();
  const b136 = box(), d137 = fraction(), s138 = narrow(), i139 = int(), e140 = either(), t141 = flag(), g142 = big(), l143 = large(), z144 = special(), w145 = wide(), r146 = rope(), p147 = slice(), k148 = point(), a149 = list(), y150 = mark(), c151 = adder(), x152 = parsed();
  const b153 = box(), d154 = fraction(), s155 = narrow(), i156 = int(), e157 = either(), t158 = flag(), g159 = big(), l160 = large(), z161 = special(), w162 = wide(), r163 = rope(), p164 = slice(), k165 = point(), a166 = list(), y167 = mark(), c168 = adder(), x169 = parsed();
  const b170 = box(), d171 = fraction(), s172 = narrow(), i173 = int(), e174 = either(), t175 = flag(), g176 = big(), l177 = large(), z178 = special(), w179 = wide(), r180 = rope(), p181 = slice(), k182 = point(), a183 = list(), y184 = mark(), c185 = adder(), x186 = parsed();
  const b187 = box(), d188 = fraction(), s189 = narrow(), i190 = int(), e191 = either(), t192 = flag(), g193 = big(), l194 = large(), z195 = special(), w196 = wide(), r197 = rope(), p198 = slice(), k199 = point(), a200 = list(), y201 = mark(), c202 = adder(), x203 = parsed();
  const b204 = box(), d205 = fraction(), s206 = narrow(), i207 = int(), e208 = either(), t209 = flag(), g210 = big(), l211 = large(), z212 = special(), w213 = wide(), r214 = rope(), p215 = slice(), k216 = point(), a217 = list(), y218 = mark(), c219 = adder(), x220 = parsed();
  const b221 = box(), d222 = fraction(), s223 = narrow(), i224 = int(), e225 = either(), t226 = flag(), g227 = big(), l228 = large(), z229 = special(), w230 = wide(), r231 = rope(), p232 = slice(), k233 = point(), a234 = list(), y235 = mark(), c236 = adder(), x237 = parsed();
  const b238 = box(), d239 = fraction(), s240 = narrow(), i241 = int(), e242 = either(), t243 = flag(), g244 = big(), l245 = large(), z246 = special(), w247 = wide(), r248 = rope(), p249 = slice(), k250 = point(), a251 = list(), y252 = mark(), c253 = adder(), x254 = parsed();
  const b255 = box(), d256 = fraction(), s257 = narrow(), i258 = int(), e259 = either(), t260 = flag(), g261 = big(), l262 = large(), z263 = special(), w264 = wide(), r265 = rope(), p266 = slice(), k267 = point(), a268 = list(), y269 = mark(), c270 = adder(), x271 = parsed();
  const b272 = box(), d273 = fraction(), s274 = narrow(), i275 = int(), e276 = either(), t277 = flag(), g278 = big(), l279 = large(), z280 = special(), w281 = wide(), r282 = rope(), p283 = slice(), k284 = point(), a285 = list(), y286 = mark(), c287 = adder(), x288 = parsed();
  const b289 = box(), d290 = fraction(), s291 = narrow(), i292 = int(), e293 = either(), t294 = flag(), g295 = big(), l296 = large(), z297 = special(), w298 = wide(), r299 = rope(), p300 = slice(), k301 = point(), a302 = list(), y303 = mark(), c304 = adder(), x305 = parsed();
  const b306 = box(), d307 = fraction(), s308 = narrow(), i309 = int(), e310 = either(), t311 = flag(), g312 = big(), l313 = large(), z314 = special(), w315 = wide(), r316 = rope(), p317 = slice(), k318 = point(), a319 = list(), y320 = mark(), c321 = adder(), x322 = parsed();
  const b323 = box(), d324 = fraction(), s325 = narrow(), i326 = int(), e327 = either(), t328 = flag(), g329 = big(), l330 = large(), z331 = special(), w332 = wide(), r333 = rope(), p334 = slice(), k335 = point(), a336 = list(), y337 = mark(), c338 = adder(), x339 = parsed();
  const b340 = box(), d341 = fraction(), s342 = narrow(), i343 = int(), e344 = either(), t345 = flag(), g346 = big(), l347 = large(), z348 = special(), w349 = wide(), r350 = rope(), p351 = slice(), k352 = point(), a353 = list(), y354 = mark(), c355 = adder(), x356 = parsed();
  const b357 = box(), d358 = fraction(), s359 = narrow(), i360 = int(), e361 = either(), t362 = flag(), g363 = big(), l364 = large(), z365 = special(), w366 = wide(), r367 = rope(), p368 = slice(), k369 = point(), a370 = list(), y371 = mark(), c372 = adder(), x373 = parsed();
  const b374 = box(), d375 = fraction(), s376 = narrow(), i377 = int(), e378 = either(), t379 = flag(), g380 = big(), l381 = large(), z382 = special(), w383 = wide(), r384 = rope(), p385 = slice(), k386 = point(), a387 = list(), y388 = mark(), c389 = adder(), x390 = parsed();
  const b391 = box(), d392 = fraction(), s393 = narrow(), i394 = int(), e395 = either(), t396 = flag(), g397 = big(), l398 = large(), z399 = special(), w400 = wide(), r401 = rope(), p402 = slice(), k403 = point(), a404 = list(), y405 = mark(), c406 = adder(), x407 = parsed();
  const b408 = box(), d409 = fraction(), s410 = narrow(), i411 = int(), e412 = either(), t413 = flag(), g414 = big(), l415 = large(), z416 = special(), w417 = wide(), r418 = rope(), p419 = slice(), k420 = point(), a421 = list(), y422 = mark(), c423 = adder(), x424 = parsed();
  const b425 = box(), d426 = fraction(), s427 = narrow(), i428 = int(), e429 = either(), t430 = flag(), g431 = big(), l432 = large(), z433 = special(), w434 = wide(), r435 = rope(), p436 = slice(), k437 = point(), a438 = list(), y439 = mark(), c440 = adder(), x441 = parsed();
  const b442 = box(), d443 = fraction(), s444 = narrow(), i445 = int(), e446 = either(), t447 = flag(), g448 = big(), l449 = large(), z450 = special(), w451 = wide(), r452 = rope(), p453 = slice(), k454 = point(), a455 = list(), y456 = mark(), c457 = adder(), x458 = parsed();
  const b459 = box(), d460 = fraction(), s461 = narrow(), i462 = int(), e463 = either(), t464 = flag(), g465 = big(), l466 = large(), z467 = special(), w468 = wide(), r469 = rope(), p470 = slice(), k471 = point(), a472 = list(), y473 = mark(), c474 = adder(), x475 = parsed();
  const b476 = box(), d477 = fraction(), s478 = narrow(), i479 = int(), e480 = either(), t481 = flag(), g482 = big(), l483 = large(), z484 = special(), w485 = wide(), r486 = rope(), p487 = slice(), k488 = point(), a489 = list(), y490 = mark(), c491 = adder(), x492 = parsed();
  const b493 = box(), d494 = fraction(), s495 = narrow(), i496 = int(), e497 = either(), t498 = flag(), g499 = big(), l500 = large(), z501 = special(), w502 = wide(), r503 = rope(), p504 = slice(), k505 = point(), a506 = list(), y507 = mark(), c508 = adder(), x509 = parsed();
  const b510 = box(), d511 = fraction(), s512 = narrow(), i513 = int(), e514 = either(), t515 = flag(), g516 = big(), l517 = large(), z518 = special(), w519 = wide(), r520 = rope(), p521 = slice(), k522 = point(), a523 = list(), y524 = mark(), c525 = adder(), x526 = parsed();
  const b527 = box(), d528 = fraction(), s529 = narrow(), i530 = int(), e531 = either(), t532 = flag(), g533 = big(), l534 = large(), z535 = special(), w536 = wide(), r537 = rope(), p538 = slice(), k539 = point(), a540 = list(), y541 = mark(), c542 = adder(), x543 = parsed();
  const b544 = box(), d545 = fraction(), s546 = narrow(), i547 = int(), e548 = either(), t549 = flag(), g550 = big(), l551 = large(), z552 = special(), w553 = wide(), r554 = rope(), p555 = slice(), k556 = point(), a557 = list(), y558 = mark(), c559 = adder(), x560 = parsed();
  const b561 = box(), d562 = fraction(), s563 = narrow(), i564 = int(), e565 = either(), t566 = flag(), g567 = big(), l568 = large(), z569 = special(), w570 = wide(), r571 = rope(), p572 = slice(), k573 = point(), a574 = list(), y575 = mark(), c576 = adder(), x577 = parsed();
  const b578 = box(), d579 = fraction(), s580 = narrow(), i581 = int(), e582 = either(), t583 = flag(), g584 = big(), l585 = large(), z586 = special(), w587 = wide(), r588 = rope(), p589 = slice(), k590 = point(), a591 = list(), y592 = mark(), c593 = adder(), x594 = parsed();
  const b595 = box(), d596 = fraction(), s597 = narrow(), i598 = int(), e599 = either(), t600 = flag(), g601 = big(), l602 = large(), z603 = special(), w604 = wide(), r605 = rope(), p606 = slice(), k607 = point(), a608 = list(), y609 = mark(), c610 = adder(), x611 = parsed();
  const b612 = box(), d613 = fraction(), s614 = narrow(), i615 = int(), e616 = either(), t617 = flag(), g618 = big(), l619 = large(), z620 = special(), w621 = wide(), r622 = rope(), p623 = slice(), k624 = point(), a625 = list(), y626 = mark(), c627 = adder(), x628 = parsed();
  const b629 = box(), d630 = fraction(), s631 = narrow(), i632 = int(), e633 = either(), t634 = flag(), g635 = big(), l636 = large(), z637 = special(), w638 = wide(), r639 = rope(), p640 = slice(), k641 = point(), a642 = list(), y643 = mark(), c644 = adder(), x645 = parsed();
  const b646 = box(), d647 = fraction(), s648 = narrow(), i649 = int(), e650 = either(), t651 = flag(), g652 = big(), l653 = large(), z654 = special(), w655 = wide(), r656 = rope(), p657 = slice(), k658 = point(), a659 = list(), y660 = mark(), c661 = adder(), x662 = parsed();
  const b663 = box(), d664 = fraction(), s665 = narrow(), i666 = int(), e667 = either(), t668 = flag(), g669 = big(), l670 = large(), z671 = special(), w672 = wide(), r673 = rope(), p674 = slice(), k675 = point(), a676 = list(), y677 = mark(), c678 = adder(), x679 = parsed();
  const b680 = box(), d681 = fraction(), s682 = narrow(), i683 = int(), e684 = either(), t685 = flag(), g686 = big(), l687 = large(), z688 = special(), w689 = wide(), r690 = rope(), p691 = slice(), k692 = point(), a693 = list(), y694 = mark(), c695 = adder(), x696 = parsed();
  const b697 = box(), d698 = fraction(), s699 = narrow(), i700 = int(), e701 = either(), t702 = flag(), g703 = big(), l704 = large(), z705 = special(), w706 = wide(), r707 = rope(), p708 = slice(), k709 = point(), a710 = list(), y711 = mark(), c712 = adder(), x713 = parsed();
  const b714 = box(), d715 = fraction(), s716 = narrow(), i717 = int(), e718 = either(), t719 = flag(), g720 = big(), l721 = large(), z722 = special(), w723 = wide(), r724 = rope(), p725 = slice(), k726 = point(), a727 = list(), y728 = mark(), c729 = adder(), x730 = parsed();
  const b731 = box(), d732 = fraction(), s733 = narrow(), i734 = int(), e735 = either(), t736 = flag(), g737 = big(), l738 = large(), z739 = special(), w740 = wide(), r741 = rope(), p742 = slice(), k743 = point(), a744 = list(), y745 = mark(), c746 = adder(), x747 = parsed();
  const b748 = box(), d749 = fraction(), s750 = narrow(), i751 = int(), e752 = either(), t753 = flag(), g754 = big(), l755 = large(), z756 = special(), w757 = wide(), r758 = rope(), p759 = slice(), k760 = point(), a761 = list(), y762 = mark(), c763 = adder(), x764 = parsed();
  const b765 = box(), d766 = fraction(), s767 = narrow(), i768 = int(), e769 = either(), t770 = flag(), g771 = big(), l772 = large(), z773 = special(), w774 = wide(), r775 = rope(), p776 = slice(), k777 = point(), a778 = list(), y779 = mark(), c780 = adder(), x781 = parsed();
  const b782 = box(), d783 = fraction(), s784 = narrow(), i785 = int(), e786 = either(), t787 = flag(), g788 = big(), l789 = large(), z790 = special(), w791 = wide(), r792 = rope(), p793 = slice(), k794 = point(), a795 = list(), y796 = mark(), c797 = adder(), x798 = parsed();
  const b799 = box(), d800 = fraction(), s801 = narrow(), i802 = int(), e803 = either(), t804 = flag(), g805 = big(), l806 = large(), z807 = special(), w808 = wide(), r809 = rope(), p810 = slice(), k811 = point(), a812 = list(), y813 = mark(), c814 = adder(), x815 = parsed();
  const b816 = box(), d817 = fraction(), s818 = narrow(), i819 = int(), e820 = either(), t821 = flag(), g822 = big(), l823 = large(), z824 = special(), w825 = wide(), r826 = rope(), p827 = slice(), k828 = point(), a829 = list(), y830 = mark(), c831 = adder(), x832 = parsed();
  const b833 = box(), d834 = fraction(), s835 = narrow(), i836 = int(), e837 = either(), t838 = flag(), g839 = big(), l840 = large(), z841 = special(), w842 = wide(), r843 = rope(), p844 = slice(), k845 = point(), a846 = list(), y847 = mark(), c848 = adder(), x849 = parsed();
  const b850 = box(), d851 = fraction(), s852 = narrow(), i853 = int(), e854 = either(), t855 = flag(), g856 = big(), l857 = large(), z858 = special(), w859 = wide(), r860 = rope(), p861 = slice(), k862 = point(), a863 = list(), y864 = mark(), c865 = adder(), x866 = parsed();
  const b867 = box(), d868 = fraction(), s869 = narrow(), i870 = int(), e871 = either(), t872 = flag(), g873 = big(), l874 = large(), z875 = special(), w876 = wide(), r877 = rope(), p878 = slice(), k879 = point(), a880 = list(), y881 = mark(), c882 = adder(), x883 = parsed();
  const b884 = box(), d885 = fraction(), s886 = narrow(), i887 = int(), e888 = either(), t889 = flag(), g890 = big(), l891 = large(), z892 = special(), w893 = wide(), r894 = rope(), p895 = slice(), k896 = point(), a897 = list(), y898 = mark(), c899 = adder(), x900 = parsed();
  const b901 = box(), d902 = fraction(), s903 = narrow(), i904 = int(), e905 = either(), t906 = flag(), g907 = big(), l908 = large(), z909 = special(), w910 = wide(), r911 = rope(), p912 = slice(), k913 = point(), a914 = list(), y915 = mark(), c916 = adder(), x917 = parsed();
  const b918 = box(), d919 = fraction(), s920 = narrow(), i921 = int(), e922 = either(), t923 = flag(), g924 = big(), l925 = large(), z926 = special(), w927 = wide(), r928 = rope(), p929 = slice(), k930 = point(), a931 = list(), y932 = mark(), c933 = adder(), x934 = parsed();
  const b935 = box(), d936 = fraction(), s937 = narrow(), i938 = int(), e939 = either(), t940 = flag(), g941 = big(), l942 = large(), z943 = special(), w944 = wide(), r945 = rope(), p946 = slice(), k947 = point(), a948 = list(), y949 = mark(), c950 = adder(), x951 = parsed();
  const b952 = box(), d953 = fraction(), s954 = narrow(), i955 = int(), e956 = either(), t957 = flag(), g958 = big(), l959 = large(), z960 = special(), w961 = wide(), r962 = rope(), p963 = slice(), k964 = point(), a965 = list(), y966 = mark(), c967 = adder(), x968 = parsed();
  const b969 = box(), d970 = fraction(), s971 = narrow(), i972 = int(), e973 = either(), t974 = flag(), g975 = big(), l976 = large(), z977 = special(), w978 = wide(), r979 = rope(), p980 = slice(), k981 = point(), a982 = list(), y983 = mark(), c984 = adder(), x985 = parsed();
  const b986 = box(), d987 = fraction(), s988 = narrow(), i989 = int(), e990 = either(), t991 = flag(), g992 = big(), l993 = large(), z994 = special(), w995 = wide(), r996 = rope(), p997 = slice(), k998 = point(), a999 = list(), y1000 = mark(), c1001 = adder(), x1002 = parsed();
  const b1003 = box(), d1004 = fraction(), s1005 = narrow(), i1006 = int(), e1007 = either(), t1008 = flag(), g1009 = big(), l1010 = large(), z1011 = special(), w1012 = wide(), r1013 = rope(), p1014 = slice(), k1015 = point(), a1016 = list(), y1017 = mark(), c1018 = adder(), x1019 = parsed();
  const b1020 = box(), d1021 = fraction(), s1022 = narrow(), i1023 = int(), e1024 = either(), t1025 = flag(), g1026 = big(), l1027 = large(), z1028 = special(), w1029 = wide(), r1030 = rope(), p1031 = slice(), k1032 = point(), a1033 = list(), y1034 = mark(), c1035 = adder(), x1036 = parsed();
  const b1037 = box(), d1038 = fraction(), s1039 = narrow(), i1040 = int(), e1041 = either(), t1042 = flag(), g1043 = big(), l1044 = large(), z1045 = special(), w1046 = wide(), r1047 = rope(), p1048 = slice(), k1049 = point(), a1050 = list(), y1051 = mark(), c1052 = adder(), x1053 = parsed();
  const b1054 = box(), d1055 = fraction(), s1056 = narrow(), i1057 = int(), e1058 = either(), t1059 = flag(), g1060 = big(), l1061 = large(), z1062 = special(), w1063 = wide(), r1064 = rope(), p1065 = slice(), k1066 = point(), a1067 = list(), y1068 = mark(), c1069 = adder(), x1070 = parsed();
  const b1071 = box(), d1072 = fraction(), s1073 = narrow(), i1074 = int(), e1075 = either(), t1076 = flag(), g1077 = big(), l1078 = large(), z1079 = special(), w1080 = wide(), r1081 = rope(), p1082 = slice(), k1083 = point(), a1084 = list(), y1085 = mark(), c1086 = adder(), x1087 = parsed();
  const b1088 = box(), d1089 = fraction(), s1090 = narrow(), i1091 = int(), e1092 = either(), t1093 = flag(), g1094 = big(), l1095 = large(), z1096 = special(), w1097 = wide(), r1098 = rope(), p1099 = slice(), k1100 = point(), a1101 = list(), y1102 = mark(), c1103 = adder(), x1104 = parsed();
  const b1105 = box(), d1106 = fraction(), s1107 = narrow(), i1108 = int(), e1109 = either(), t1110 = flag(), g1111 = big(), l1112 = large(), z1113 = special(), w1114 = wide(), r1115 = rope(), p1116 = slice(), k1117 = point(), a1118 = list(), y1119 = mark(), c1120 = adder(), x1121 = parsed();
  const b1122 = box(), d1123 = fraction(), s1124 = narrow(), i1125 = int(), e1126 = either(), t1127 = flag(), g1128 = big(), l1129 = large(), z1130 = special(), w1131 = wide(), r1132 = rope(), p1133 = slice(), k1134 = point(), a1135 = list(), y1136 = mark(), c1137 = adder(), x1138 = parsed();
  const b1139 = box(), d1140 = fraction(), s1141 = narrow(), i1142 = int(), e1143 = either(), t1144 = flag(), g1145 = big(), l1146 = large(), z1147 = special(), w1148 = wide(), r1149 = rope(), p1150 = slice(), k1151 = point(), a1152 = list(), y1153 = mark(), c1154 = adder(), x1155 = parsed();
  const b1156 = box(), d1157 = fraction(), s1158 = narrow(), i1159 = int(), e1160 = either(), t1161 = flag(), g1162 = big(), l1163 = large(), z1164 = special(), w1165 = wide(), r1166 = rope(), p1167 = slice(), k1168 = point(), a1169 = list(), y1170 = mark(), c1171 = adder(), x1172 = parsed();
  const b1173 = box(), d1174 = fraction(), s1175 = narrow(), i1176 = int(), e1177 = either(), t1178 = flag(), g1179 = big(), l1180 = large(), z1181 = special(), w1182 = wide(), r1183 = rope(), p1184 = slice(), k1185 = point(), a1186 = list(), y1187 = mark(), c1188 = adder(), x1189 = parsed();
  const b1190 = box(), d1191 = fraction(), s1192 = narrow(), i1193 = int(), e1194 = either(), t1195 = flag(), g1196 = big(), l1197 = large(), z1198 = special(), w1199 = wide(), r1200 = rope(), p1201 = slice(), k1202 = point(), a1203 = list(), y1204 = mark(), c1205 = adder(), x1206 = parsed();
  const b1207 = box(), d1208 = fraction(), s1209 = narrow(), i1210 = int(), e1211 = either(), t1212 = flag(), g1213 = big(), l1214 = large(), z1215 = special(), w1216 = wide(), r1217 = rope(), p1218 = slice(), k1219 = point(), a1220 = list(), y1221 = mark(), c1222 = adder(), x1223 = parsed();
  const b1224 = box(), d1225 = fraction(), s1226 = narrow(), i1227 = int(), e1228 = either(), t1229 = flag(), g1230 = big(), l1231 = large(), z1232 = special(), w1233 = wide(), r1234 = rope(), p1235 = slice(), k1236 = point(), a1237 = list(), y1238 = mark(), c1239 = adder(), x1240 = parsed();
  const b1241 = box(), d1242 = fraction(), s1243 = narrow(), i1244 = int(), e1245 = either(), t1246 = flag(), g1247 = big(), l1248 = large(), z1249 = special(), w1250 = wide(), r1251 = rope(), p1252 = slice(), k1253 = point(), a1254 = list(), y1255 = mark(), c1256 = adder(), x1257 = parsed();
  const b1258 = box(), d1259 = fraction(), s1260 = narrow(), i1261 = int(), e1262 = either(), t1263 = flag(), g1264 = big(), l1265 = large(), z1266 = special(), w1267 = wide(), r1268 = rope(), p1269 = slice(), k1270 = point(), a1271 = list(), y1272 = mark(), c1273 = adder(), x1274 = parsed();
  const b1275 = box(), d1276 = fraction(), s1277 = narrow(), i1278 = int(), e1279 = either(), t1280 = flag(), g1281 = big(), l1282 = large(), z1283 = special(), w1284 = wide(), r1285 = rope(), p1286 = slice(), k1287 = point(), a1288 = list(), y1289 = mark(), c1290 = adder(), x1291 = parsed();
  const b1292 = box(), d1293 = fraction(), s1294 = narrow(), i1295 = int(), e1296 = either(), t1297 = flag(), g1298 = big(), l1299 = large(), z1300 = special(), w1301 = wide(), r1302 = rope(), p1303 = slice(), k1304 = point(), a1305 = list(), y1306 = mark(), c1307 = adder(), x1308 = parsed();
  const b1309 = box(), d1310 = fraction(), s1311 = narrow(), i1312 = int(), e1313 = either(), t1314 = flag(), g1315 = big(), l1316 = large(), z1317 = special(), w1318 = wide(), r1319 = rope(), p1320 = slice(), k1321 = point(), a1322 = list(), y1323 = mark(), c1324 = adder(), x1325 = parsed();
  const b1326 = box(), d1327 = fraction(), s1328 = narrow(), i1329 = int(), e1330 = either(), t1331 = flag(), g1332 = big(), l1333 = large(), z1334 = special(), w1335 = wide(), r1336 = rope(), p1337 = slice(), k1338 = point(), a1339 = list(), y1340 = mark(), c1341 = adder(), x1342 = parsed();
  const b1343 = box(), d1344 = fraction(), s1345 = narrow(), i1346 = int(), e1347 = either(), t1348 = flag(), g1349 = big(), l1350 = large(), z1351 = special(), w1352 = wide(), r1353 = rope(), p1354 = slice(), k1355 = point(), a1356 = list(), y1357 = mark(), c1358 = adder(), x1359 = parsed();
  const b1360 = box(), d1361 = fraction(), s1362 = narrow(), i1363 = int(), e1364 = either(), t1365 = flag(), g1366 = big(), l1367 = large(), z1368 = special(), w1369 = wide(), r1370 = rope(), p1371 = slice(), k1372 = point(), a1373 = list(), y1374 = mark(), c1375 = adder(), x1376 = parsed();
  const b1377 = box(), d1378 = fraction(), s1379 = narrow(), i1380 = int(), e1381 = either(), t1382 = flag(), g1383 = big(), l1384 = large(), z1385 = special(), w1386 = wide(), r1387 = rope(), p1388 = slice(), k1389 = point(), a1390 = list(), y1391 = mark(), c1392 = adder(), x1393 = parsed();
  const b1394 = box(), d1395 = fraction(), s1396 = narrow(), i1397 = int(), e1398 = either(), t1399 = flag(), g1400 = big(), l1401 = large(), z1402 = special(), w1403 = wide(), r1404 = rope(), p1405 = slice(), k1406 = point(), a1407 = list(), y1408 = mark(), c1409 = adder(), x1410 = parsed();
  const b1411 = box(), d1412 = fraction(), s1413 = narrow(), i1414 = int(), e1415 = either(), t1416 = flag(), g1417 = big(), l1418 = large(), z1419 = special(), w1420 = wide(), r1421 = rope(), p1422 = slice(), k1423 = point(), a1424 = list(), y1425 = mark(), c1426 = adder(), x1427 = parsed();
  const b1428 = box(), d1429 = fraction(), s1430 = narrow(), i1431 = int(), e1432 = either(), t1433 = flag(), g1434 = big(), l1435 = large(), z1436 = special(), w1437 = wide(), r1438 = rope(), p1439 = slice(), k1440 = point(), a1441 = list(), y1442 = mark(), c1443 = adder(), x1444 = parsed();
  const b1445 = box(), d1446 = fraction(), s1447 = narrow(), i1448 = int(), e1449 = either(), t1450 = flag(), g1451 = big(), l1452 = large(), z1453 = special(), w1454 = wide(), r1455 = rope(), p1456 = slice(), k1457 = point(), a1458 = list(), y1459 = mark(), c1460 = adder(), x1461 = parsed();
  const b1462 = box(), d1463 = fraction(), s1464 = narrow(), i1465 = int(), e1466 = either(), t1467 = flag(), g1468 = big(), l1469 = large(), z1470 = special(), w1471 = wide(), r1472 = rope(), p1473 = slice(), k1474 = point(), a1475 = list(), y1476 = mark(), c1477 = adder(), x1478 = parsed();
  const b1479 = box(), d1480 = fraction(), s1481 = narrow(), i1482 = int(), e1483 = either(), t1484 = flag(), g1485 = big(), l1486 = large(), z1487 = special(), w1488 = wide(), r1489 = rope(), p1490 = slice(), k1491 = point(), a1492 = list(), y1493 = mark(), c1494 = adder(), x1495 = parsed();
  const b1496 = box(), d1497 = fraction(), s1498 = narrow(), i1499 = int(), e1500 = either(), t1501 = flag(), g1502 = big(), l1503 = large(), z1504 = special(), w1505 = wide(), r1506 = rope(), p1507 = slice(), k1508 = point(), a1509 = list(), y1510 = mark(), c1511 = adder(), x1512 = parsed();
  const b1513 = box(), d1514 = fraction(), s1515 = narrow(), i1516 = int(), e1517 = either(), t1518 = flag(), g1519 = big(), l1520 = large(), z1521 = special(), w1522 = wide(), r1523 = rope(), p1524 = slice(), k1525 = point(), a1526 = list(), y1527 = mark(), c1528 = adder(), x1529 = parsed();
  const b1530 = box(), d1531 = fraction(), s1532 = narrow(), i1533 = int(), e1534 = either(), t1535 = flag(), g1536 = big(), l1537 = large(), z1538 = special(), w1539 = wide(), r1540 = rope(), p1541 = slice(), k1542 = point(), a1543 = list(), y1544 = mark(), c1545 = adder(), x1546 = parsed();
  const b1547 = box(), d1548 = fraction(), s1549 = narrow(), i1550 = int(), e1551 = either(), t1552 = flag(), g1553 = big(), l1554 = large(), z1555 = special(), w1556 = wide(), r1557 = rope(), p1558 = slice(), k1559 = point(), a1560 = list(), y1561 = mark(), c1562 = adder(), x1563 = parsed();
  const b1564 = box(), d1565 = fraction(), s1566 = narrow(), i1567 = int(), e1568 = either(), t1569 = flag(), g1570 = big(), l1571 = large(), z1572 = special(), w1573 = wide(), r1574 = rope(), p1575 = slice(), k1576 = point(), a1577 = list(), y1578 = mark(), c1579 = adder(), x1580 = parsed();
  const b1581 = box(), d1582 = fraction(), s1583 = narrow(), i1584 = int(), e1585 = either(), t1586 = flag(), g1587 = big(), l1588 = large(), z1589 = special(), w1590 = wide(), r1591 = rope(), p1592 = slice(), k1593 = point(), a1594 = list(), y1595 = mark(), c1596 = adder(), x1597 = parsed();
  const b1598 = box(), d1599 = fraction(), s1600 = narrow(), i1601 = int(), e1602 = either(), t1603 = flag(), g1604 = big(), l1605 = large(), z1606 = special(), w1607 = wide(), r1608 = rope(), p1609 = slice(), k1610 = point(), a1611 = list(), y1612 = mark(), c1613 = adder(), x1614 = parsed();
  const b1615 = box(), d1616 = fraction(), s1617 = narrow(), i1618 = int(), e1619 = either(), t1620 = flag(), g1621 = big(), l1622 = large(), z1623 = special(), w1624 = wide(), r1625 = rope(), p1626 = slice(), k1627 = point(), a1628 = list(), y1629 = mark(), c1630 = adder(), x1631 = parsed();
  const b1632 = box(), d1633 = fraction(), s1634 = narrow(), i1635 = int(), e1636 = either(), t1637 = flag(), g1638 = big(), l1639 = large(), z1640 = special(), w1641 = wide(), r1642 = rope(), p1643 = slice(), k1644 = point(), a1645 = list(), y1646 = mark(), c1647 = adder(), x1648 = parsed();
  const b1649 = box(), d1650 = fraction(), s1651 = narrow(), i1652 = int(), e1653 = either(), t1654 = flag(), g1655 = big(), l1656 = large(), z1657 = special(), w1658 = wide(), r1659 = rope(), p1660 = slice(), k1661 = point(), a1662 = list(), y1663 = mark(), c1664 = adder(), x1665 = parsed();
  const b1666 = box(), d1667 = fraction(), s1668 = narrow(), i1669 = int(), e1670 = either(), t1671 = flag(), g1672 = big(), l1673 = large(), z1674 = special(), w1675 = wide(), r1676 = rope(), p1677 = slice(), k1678 = point(), a1679 = list(), y1680 = mark(), c1681 = adder(), x1682 = parsed();
  const b1683 = box(), d1684 = fraction(), s1685 = narrow(), i1686 = int(), e1687 = either(), t1688 = flag(), g1689 = big(), l1690 = large(), z1691 = special(), w1692 = wide(), r1693 = rope(), p1694 = slice(), k1695 = point(), a1696 = list(), y1697 = mark(), c1698 = adder(), x1699 = parsed();
  const b1700 = box(), d1701 = fraction(), s1702 = narrow(), i1703 = int(), e1704 = either(), t1705 = flag(), g1706 = big(), l1707 = large(), z1708 = special(), w1709 = wide(), r1710 = rope(), p1711 = slice(), k1712 = point(), a1713 = list(), y1714 = mark(), c1715 = adder(), x1716 = parsed();
  const b1717 = box(), d1718 = fraction(), s1719 = narrow(), i1720 = int(), e1721 = either(), t1722 = flag(), g1723 = big(), l1724 = large(), z1725 = special(), w1726 = wide(), r1727 = rope(), p1728 = slice(), k1729 = point(), a1730 = list(), y1731 = mark(), c1732 = adder(), x1733 = parsed();
  const b1734 = box(), d1735 = fraction(), s1736 = narrow(), i1737 = int(), e1738 = either(), t1739 = flag(), g1740 = big(), l1741 = large(), z1742 = special(), w1743 = wide(), r1744 = rope(), p1745 = slice(), k1746 = point(), a1747 = list(), y1748 = mark(), c1749 = adder(), x1750 = parsed();
  const b1751 = box(), d1752 = fraction(), s1753 = narrow(), i1754 = int(), e1755 = either(), t1756 = flag(), g1757 = big(), l1758 = large(), z1759 = special(), w1760 = wide(), r1761 = rope(), p1762 = slice(), k1763 = point(), a1764 = list(), y1765 = mark(), c1766 = adder(), x1767 = parsed();
  const b1768 = box(), d1769 = fraction(), s1770 = narrow(), i1771 = int(), e1772 = either(), t1773 = flag(), g1774 = big(), l1775 = large(), z1776 = special(), w1777 = wide(), r1778 = rope(), p1779 = slice(), k1780 = point(), a1781 = list(), y1782 = mark(), c1783 = adder(), x1784 = parsed();
  const b1785 = box(), d1786 = fraction(), s1787 = narrow(), i1788 = int(), e1789 = either(), t1790 = flag(), g1791 = big(), l1792 = large(), z1793 = special(), w1794 = wide(), r1795 = rope(), p1796 = slice(), k1797 = point(), a1798 = list(), y1799 = mark(), c1800 = adder(), x1801 = parsed();
  const b1802 = box(), d1803 = fraction(), s1804 = narrow(), i1805 = int(), e1806 = either(), t1807 = flag(), g1808 = big(), l1809 = large(), z1810 = special(), w1811 = wide(), r1812 = rope(), p1813 = slice(), k1814 = point(), a1815 = list(), y1816 = mark(), c1817 = adder(), x1818 = parsed();
  const b1819 = box(), d1820 = fraction(), s1821 = narrow(), i1822 = int(), e1823 = either(), t1824 = flag(), g1825 = big(), l1826 = large(), z1827 = special(), w1828 = wide(), r1829 = rope(), p1830 = slice(), k1831 = point(), a1832 = list(), y1833 = mark(), c1834 = adder(), x1835 = parsed();
  const b1836 = box(), d1837 = fraction(), s1838 = narrow(), i1839 = int(), e1840 = either(), t1841 = flag(), g1842 = big(), l1843 = large(), z1844 = special(), w1845 = wide(), r1846 = rope(), p1847 = slice(), k1848 = point(), a1849 = list(), y1850 = mark(), c1851 = adder(), x1852 = parsed();
  const b1853 = box(), d1854 = fraction(), s1855 = narrow(), i1856 = int(), e1857 = either(), t1858 = flag(), g1859 = big(), l1860 = large(), z1861 = special(), w1862 = wide(), r1863 = rope(), p1864 = slice(), k1865 = point(), a1866 = list(), y1867 = mark(), c1868 = adder(), x1869 = parsed();
  const b1870 = box(), d1871 = fraction(), s1872 = narrow(), i1873 = int(), e1874 = either(), t1875 = flag(), g1876 = big(), l1877 = large(), z1878 = special(), w1879 = wide(), r1880 = rope(), p1881 = slice(), k1882 = point(), a1883 = list(), y1884 = mark(), c1885 = adder(), x1886 = parsed();
  const b1887 = box(), d1888 = fraction(), s1889 = narrow(), i1890 = int(), e1891 = either(), t1892 = flag(), g1893 = big(), l1894 = large(), z1895 = special(), w1896 = wide(), r1897 = rope(), p1898 = slice(), k1899 = point(), a1900 = list(), y1901 = mark(), c1902 = adder(), x1903 = parsed();
  const b1904 = box(), d1905 = fraction(), s1906 = narrow(), i1907 = int(), e1908 = either(), t1909 = flag(), g1910 = big(), l1911 = large(), z1912 = special(), w1913 = wide(), r1914 = rope(), p1915 = slice(), k1916 = point(), a1917 = list(), y1918 = mark(), c1919 = adder(), x1920 = parsed();
  const b1921 = box(), d1922 = fraction(), s1923 = narrow(), i1924 = int(), e1925 = either(), t1926 = flag(), g1927 = big(), l1928 = large(), z1929 = special(), w1930 = wide(), r1931 = rope(), p1932 = slice(), k1933 = point(), a1934 = list(), y1935 = mark(), c1936 = adder(), x1937 = parsed();
  const b1938 = box(), d1939 = fraction(), s1940 = narrow(), i1941 = int(), e1942 = either(), t1943 = flag(), g1944 = big(), l1945 = large(), z1946 = special(), w1947 = wide(), r1948 = rope(), p1949 = slice(), k1950 = point(), a1951 = list(), y1952 = mark(), c1953 = adder(), x1954 = parsed();
  const b1955 = box(), d1956 = fraction(), s1957 = narrow(), i1958 = int(), e1959 = either(), t1960 = flag(), g1961 = big(), l1962 = large(), z1963 = special(), w1964 = wide(), r1965 = rope(), p1966 = slice(), k1967 = point(), a1968 = list(), y1969 = mark(), c1970 = adder(), x1971 = parsed();
  const b1972 = box(), d1973 = fraction(), s1974 = narrow(), i1975 = int(), e1976 = either(), t1977 = flag(), g1978 = big(), l1979 = large(), z1980 = special(), w1981 = wide(), r1982 = rope(), p1983 = slice(), k1984 = point(), a1985 = list(), y1986 = mark(), c1987 = adder(), x1988 = parsed();
  const b1989 = box(), d1990 = fraction(), s1991 = narrow(), i1992 = int(), e1993 = either(), t1994 = flag(), g1995 = big(), l1996 = large(), z1997 = special(), w1998 = wide(), r1999 = rope();
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = fold(h, b34, d35, s36, i37, e38, t39, g40, l41, z42, w43, r44, p45, k46, a47, y48, c49, x50);
  h = fold(h, b51, d52, s53, i54, e55, t56, g57, l58, z59, w60, r61, p62, k63, a64, y65, c66, x67);
  h = fold(h, b68, d69, s70, i71, e72, t73, g74, l75, z76, w77, r78, p79, k80, a81, y82, c83, x84);
  h = fold(h, b85, d86, s87, i88, e89, t90, g91, l92, z93, w94, r95, p96, k97, a98, y99, c100, x101);
  h = fold(h, b102, d103, s104, i105, e106, t107, g108, l109, z110, w111, r112, p113, k114, a115, y116, c117, x118);
  h = fold(h, b119, d120, s121, i122, e123, t124, g125, l126, z127, w128, r129, p130, k131, a132, y133, c134, x135);
  h = fold(h, b136, d137, s138, i139, e140, t141, g142, l143, z144, w145, r146, p147, k148, a149, y150, c151, x152);
  h = fold(h, b153, d154, s155, i156, e157, t158, g159, l160, z161, w162, r163, p164, k165, a166, y167, c168, x169);
  h = fold(h, b170, d171, s172, i173, e174, t175, g176, l177, z178, w179, r180, p181, k182, a183, y184, c185, x186);
  h = fold(h, b187, d188, s189, i190, e191, t192, g193, l194, z195, w196, r197, p198, k199, a200, y201, c202, x203);
  h = fold(h, b204, d205, s206, i207, e208, t209, g210, l211, z212, w213, r214, p215, k216, a217, y218, c219, x220);
  h = fold(h, b221, d222, s223, i224, e225, t226, g227, l228, z229, w230, r231, p232, k233, a234, y235, c236, x237);
  h = fold(h, b238, d239, s240, i241, e242, t243, g244, l245, z246, w247, r248, p249, k250, a251, y252, c253, x254);
  h = fold(h, b255, d256, s257, i258, e259, t260, g261, l262, z263, w264, r265, p266, k267, a268, y269, c270, x271);
  h = fold(h, b272, d273, s274, i275, e276, t277, g278, l279, z280, w281, r282, p283, k284, a285, y286, c287, x288);
  h = fold(h, b289, d290, s291, i292, e293, t294, g295, l296, z297, w298, r299, p300, k301, a302, y303, c304, x305);
  h = fold(h, b306, d307, s308, i309, e310, t311, g312, l313, z314, w315, r316, p317, k318, a319, y320, c321, x322);
  h = fold(h, b323, d324, s325, i326, e327, t328, g329, l330, z331, w332, r333, p334, k335, a336, y337, c338, x339);
  h = fold(h, b340, d341, s342, i343, e344, t345, g346, l347, z348, w349, r350, p351, k352, a353, y354, c355, x356);
  h = fold(h, b357, d358, s359, i360, e361, t362, g363, l364, z365, w366, r367, p368, k369, a370, y371, c372, x373);
  h = fold(h, b374, d375, s376, i377, e378, t379, g380, l381, z382, w383, r384, p385, k386, a387, y388, c389, x390);
  h = fold(h, b391, d392, s393, i394, e395, t396, g397, l398, z399, w400, r401, p402, k403, a404, y405, c406, x407);
  h = fold(h, b408, d409, s410, i411, e412, t413, g414, l415, z416, w417, r418, p419, k420, a421, y422, c423, x424);
  h = fold(h, b425, d426, s427, i428, e429, t430, g431, l432, z433, w434, r435, p436, k437, a438, y439, c440, x441);
  h = fold(h, b442, d443, s444, i445, e446, t447, g448, l449, z450, w451, r452, p453, k454, a455, y456, c457, x458);
  h = fold(h, b459, d460, s461, i462, e463, t464, g465, l466, z467, w468, r469, p470, k471, a472, y473, c474, x475);
  h = fold(h, b476, d477, s478, i479, e480, t481, g482, l483, z484, w485, r486, p487, k488, a489, y490, c491, x492);
  h = fold(h, b493, d494, s495, i496, e497, t498, g499, l500, z501, w502, r503, p504, k505, a506, y507, c508, x509);
  h = fold(h, b510, d511, s512, i513, e514, t515, g516, l517, z518, w519, r520, p521, k522, a523, y524, c525, x526);
  h = fold(h, b527, d528, s529, i530, e531, t532, g533, l534, z535, w536, r537, p538, k539, a540, y541, c542, x543);
  h = fold(h, b544, d545, s546, i547, e548, t549, g550, l551, z552, w553, r554, p555, k556, a557, y558, c559, x560);
  h = fold(h, b561, d562, s563, i564, e565, t566, g567, l568, z569, w570, r571, p572, k573, a574, y575, c576, x577);
  h = fold(h, b578, d579, s580, i581, e582, t583, g584, l585, z586, w587, r588, p589, k590, a591, y592, c593, x594);
  h = fold(h, b595, d596, s597, i598, e599, t600, g601, l602, z603, w604, r605, p606, k607, a608, y609, c610, x611);
  h = fold(h, b612, d613, s614, i615, e616, t617, g618, l619, z620, w621, r622, p623, k624, a625, y626, c627, x628);
  h = fold(h, b629, d630, s631, i632, e633, t634, g635, l636, z637, w638, r639, p640, k641, a642, y643, c644, x645);
  h = fold(h, b646, d647, s648, i649, e650, t651, g652, l653, z654, w655, r656, p657, k658, a659, y660, c661, x662);
  h = fold(h, b663, d664, s665, i666, e667, t668, g669, l670, z671, w672, r673, p674, k675, a676, y677, c678, x679);
  h = fold(h, b680, d681, s682, i683, e684, t685, g686, l687, z688, w689, r690, p691, k692, a693, y694, c695, x696);
  h = fold(h, b697, d698, s699, i700, e701, t702, g703, l704, z705, w706, r707, p708, k709, a710, y711, c712, x713);
  h = fold(h, b714, d715, s716, i717, e718, t719, g720, l721, z722, w723, r724, p725, k726, a727, y728, c729, x730);
  h = fold(h, b731, d732, s733, i734, e735, t736, g737, l738, z739, w740, r741, p742, k743, a744, y745, c746, x747);
  h = fold(h, b748, d749, s750, i751, e752, t753, g754, l755, z756, w757, r758, p759, k760, a761, y762, c763, x764);
  h = fold(h, b765, d766, s767, i768, e769, t770, g771, l772, z773, w774, r775, p776, k777, a778, y779, c780, x781);
  h = fold(h, b782, d783, s784, i785, e786, t787, g788, l789, z790, w791, r792, p793, k794, a795, y796, c797, x798);
  h = fold(h, b799, d800, s801, i802, e803, t804, g805, l806, z807, w808, r809, p810, k811, a812, y813, c814, x815);
  h = fold(h, b816, d817, s818, i819, e820, t821, g822, l823, z824, w825, r826, p827, k828, a829, y830, c831, x832);
  h = fold(h, b833, d834, s835, i836, e837, t838, g839, l840, z841, w842, r843, p844, k845, a846, y847, c848, x849);
  h = fold(h, b850, d851, s852, i853, e854, t855, g856, l857, z858, w859, r860, p861, k862, a863, y864, c865, x866);
  h = fold(h, b867, d868, s869, i870, e871, t872, g873, l874, z875, w876, r877, p878, k879, a880, y881, c882, x883);
  h = fold(h, b884, d885, s886, i887, e888, t889, g890, l891, z892, w893, r894, p895, k896, a897, y898, c899, x900);
  h = fold(h, b901, d902, s903, i904, e905, t906, g907, l908, z909, w910, r911, p912, k913, a914, y915, c916, x917);
  h = fold(h, b918, d919, s920, i921, e922, t923, g924, l925, z926, w927, r928, p929, k930, a931, y932, c933, x934);
  h = fold(h, b935, d936, s937, i938, e939, t940, g941, l942, z943, w944, r945, p946, k947, a948, y949, c950, x951);
  h = fold(h, b952, d953, s954, i955, e956, t957, g958, l959, z960, w961, r962, p963, k964, a965, y966, c967, x968);
  h = fold(h, b969, d970, s971, i972, e973, t974, g975, l976, z977, w978, r979, p980, k981, a982, y983, c984, x985);
  h = fold(h, b986, d987, s988, i989, e990, t991, g992, l993, z994, w995, r996, p997, k998, a999, y1000, c1001, x1002);
  h = fold(h, b1003, d1004, s1005, i1006, e1007, t1008, g1009, l1010, z1011, w1012, r1013, p1014, k1015, a1016, y1017, c1018, x1019);
  h = fold(h, b1020, d1021, s1022, i1023, e1024, t1025, g1026, l1027, z1028, w1029, r1030, p1031, k1032, a1033, y1034, c1035, x1036);
  h = fold(h, b1037, d1038, s1039, i1040, e1041, t1042, g1043, l1044, z1045, w1046, r1047, p1048, k1049, a1050, y1051, c1052, x1053);
  h = fold(h, b1054, d1055, s1056, i1057, e1058, t1059, g1060, l1061, z1062, w1063, r1064, p1065, k1066, a1067, y1068, c1069, x1070);
  h = fold(h, b1071, d1072, s1073, i1074, e1075, t1076, g1077, l1078, z1079, w1080, r1081, p1082, k1083, a1084, y1085, c1086, x1087);
  h = fold(h, b1088, d1089, s1090, i1091, e1092, t1093, g1094, l1095, z1096, w1097, r1098, p1099, k1100, a1101, y1102, c1103, x1104);
  h = fold(h, b1105, d1106, s1107, i1108, e1109, t1110, g1111, l1112, z1113, w1114, r1115, p1116, k1117, a1118, y1119, c1120, x1121);
  h = fold(h, b1122, d1123, s1124, i1125, e1126, t1127, g1128, l1129, z1130, w1131, r1132, p1133, k1134, a1135, y1136, c1137, x1138);
  h = fold(h, b1139, d1140, s1141, i1142, e1143, t1144, g1145, l1146, z1147, w1148, r1149, p1150, k1151, a1152, y1153, c1154, x1155);
  h = fold(h, b1156, d1157, s1158, i1159, e1160, t1161, g1162, l1163, z1164, w1165, r1166, p1167, k1168, a1169, y1170, c1171, x1172);
  h = fold(h, b1173, d1174, s1175, i1176, e1177, t1178, g1179, l1180, z1181, w1182, r1183, p1184, k1185, a1186, y1187, c1188, x1189);
  h = fold(h, b1190, d1191, s1192, i1193, e1194, t1195, g1196, l1197, z1198, w1199, r1200, p1201, k1202, a1203, y1204, c1205, x1206);
  h = fold(h, b1207, d1208, s1209, i1210, e1211, t1212, g1213, l1214, z1215, w1216, r1217, p1218, k1219, a1220, y1221, c1222, x1223);
  h = fold(h, b1224, d1225, s1226, i1227, e1228, t1229, g1230, l1231, z1232, w1233, r1234, p1235, k1236, a1237, y1238, c1239, x1240);
  h = fold(h, b1241, d1242, s1243, i1244, e1245, t1246, g1247, l1248, z1249, w1250, r1251, p1252, k1253, a1254, y1255, c1256, x1257);
  h = fold(h, b1258, d1259, s1260, i1261, e1262, t1263, g1264, l1265, z1266, w1267, r1268, p1269, k1270, a1271, y1272, c1273, x1274);
  h = fold(h, b1275, d1276, s1277, i1278, e1279, t1280, g1281, l1282, z1283, w1284, r1285, p1286, k1287, a1288, y1289, c1290, x1291);
  h = fold(h, b1292, d1293, s1294, i1295, e1296, t1297, g1298, l1299, z1300, w1301, r1302, p1303, k1304, a1305, y1306, c1307, x1308);
  h = fold(h, b1309, d1310, s1311, i1312, e1313, t1314, g1315, l1316, z1317, w1318, r1319, p1320, k1321, a1322, y1323, c1324, x1325);
  h = fold(h, b1326, d1327, s1328, i1329, e1330, t1331, g1332, l1333, z1334, w1335, r1336, p1337, k1338, a1339, y1340, c1341, x1342);
  h = fold(h, b1343, d1344, s1345, i1346, e1347, t1348, g1349, l1350, z1351, w1352, r1353, p1354, k1355, a1356, y1357, c1358, x1359);
  h = fold(h, b1360, d1361, s1362, i1363, e1364, t1365, g1366, l1367, z1368, w1369, r1370, p1371, k1372, a1373, y1374, c1375, x1376);
  h = fold(h, b1377, d1378, s1379, i1380, e1381, t1382, g1383, l1384, z1385, w1386, r1387, p1388, k1389, a1390, y1391, c1392, x1393);
  h = fold(h, b1394, d1395, s1396, i1397, e1398, t1399, g1400, l1401, z1402, w1403, r1404, p1405, k1406, a1407, y1408, c1409, x1410);
  h = fold(h, b1411, d1412, s1413, i1414, e1415, t1416, g1417, l1418, z1419, w1420, r1421, p1422, k1423, a1424, y1425, c1426, x1427);
  h = fold(h, b1428, d1429, s1430, i1431, e1432, t1433, g1434, l1435, z1436, w1437, r1438, p1439, k1440, a1441, y1442, c1443, x1444);
  h = fold(h, b1445, d1446, s1447, i1448, e1449, t1450, g1451, l1452, z1453, w1454, r1455, p1456, k1457, a1458, y1459, c1460, x1461);
  h = fold(h, b1462, d1463, s1464, i1465, e1466, t1467, g1468, l1469, z1470, w1471, r1472, p1473, k1474, a1475, y1476, c1477, x1478);
  h = fold(h, b1479, d1480, s1481, i1482, e1483, t1484, g1485, l1486, z1487, w1488, r1489, p1490, k1491, a1492, y1493, c1494, x1495);
  h = fold(h, b1496, d1497, s1498, i1499, e1500, t1501, g1502, l1503, z1504, w1505, r1506, p1507, k1508, a1509, y1510, c1511, x1512);
  h = fold(h, b1513, d1514, s1515, i1516, e1517, t1518, g1519, l1520, z1521, w1522, r1523, p1524, k1525, a1526, y1527, c1528, x1529);
  h = fold(h, b1530, d1531, s1532, i1533, e1534, t1535, g1536, l1537, z1538, w1539, r1540, p1541, k1542, a1543, y1544, c1545, x1546);
  h = fold(h, b1547, d1548, s1549, i1550, e1551, t1552, g1553, l1554, z1555, w1556, r1557, p1558, k1559, a1560, y1561, c1562, x1563);
  h = fold(h, b1564, d1565, s1566, i1567, e1568, t1569, g1570, l1571, z1572, w1573, r1574, p1575, k1576, a1577, y1578, c1579, x1580);
  h = fold(h, b1581, d1582, s1583, i1584, e1585, t1586, g1587, l1588, z1589, w1590, r1591, p1592, k1593, a1594, y1595, c1596, x1597);
  h = fold(h, b1598, d1599, s1600, i1601, e1602, t1603, g1604, l1605, z1606, w1607, r1608, p1609, k1610, a1611, y1612, c1613, x1614);
  h = fold(h, b1615, d1616, s1617, i1618, e1619, t1620, g1621, l1622, z1623, w1624, r1625, p1626, k1627, a1628, y1629, c1630, x1631);
  h = fold(h, b1632, d1633, s1634, i1635, e1636, t1637, g1638, l1639, z1640, w1641, r1642, p1643, k1644, a1645, y1646, c1647, x1648);
  h = fold(h, b1649, d1650, s1651, i1652, e1653, t1654, g1655, l1656, z1657, w1658, r1659, p1660, k1661, a1662, y1663, c1664, x1665);
  h = fold(h, b1666, d1667, s1668, i1669, e1670, t1671, g1672, l1673, z1674, w1675, r1676, p1677, k1678, a1679, y1680, c1681, x1682);
  h = fold(h, b1683, d1684, s1685, i1686, e1687, t1688, g1689, l1690, z1691, w1692, r1693, p1694, k1695, a1696, y1697, c1698, x1699);
  h = fold(h, b1700, d1701, s1702, i1703, e1704, t1705, g1706, l1707, z1708, w1709, r1710, p1711, k1712, a1713, y1714, c1715, x1716);
  h = fold(h, b1717, d1718, s1719, i1720, e1721, t1722, g1723, l1724, z1725, w1726, r1727, p1728, k1729, a1730, y1731, c1732, x1733);
  h = fold(h, b1734, d1735, s1736, i1737, e1738, t1739, g1740, l1741, z1742, w1743, r1744, p1745, k1746, a1747, y1748, c1749, x1750);
  h = fold(h, b1751, d1752, s1753, i1754, e1755, t1756, g1757, l1758, z1759, w1760, r1761, p1762, k1763, a1764, y1765, c1766, x1767);
  h = fold(h, b1768, d1769, s1770, i1771, e1772, t1773, g1774, l1775, z1776, w1777, r1778, p1779, k1780, a1781, y1782, c1783, x1784);
  h = fold(h, b1785, d1786, s1787, i1788, e1789, t1790, g1791, l1792, z1793, w1794, r1795, p1796, k1797, a1798, y1799, c1800, x1801);
  h = fold(h, b1802, d1803, s1804, i1805, e1806, t1807, g1808, l1809, z1810, w1811, r1812, p1813, k1814, a1815, y1816, c1817, x1818);
  h = fold(h, b1819, d1820, s1821, i1822, e1823, t1824, g1825, l1826, z1827, w1828, r1829, p1830, k1831, a1832, y1833, c1834, x1835);
  h = fold(h, b1836, d1837, s1838, i1839, e1840, t1841, g1842, l1843, z1844, w1845, r1846, p1847, k1848, a1849, y1850, c1851, x1852);
  h = fold(h, b1853, d1854, s1855, i1856, e1857, t1858, g1859, l1860, z1861, w1862, r1863, p1864, k1865, a1866, y1867, c1868, x1869);
  h = fold(h, b1870, d1871, s1872, i1873, e1874, t1875, g1876, l1877, z1878, w1879, r1880, p1881, k1882, a1883, y1884, c1885, x1886);
  h = fold(h, b1887, d1888, s1889, i1890, e1891, t1892, g1893, l1894, z1895, w1896, r1897, p1898, k1899, a1900, y1901, c1902, x1903);
  h = fold(h, b1904, d1905, s1906, i1907, e1908, t1909, g1910, l1911, z1912, w1913, r1914, p1915, k1916, a1917, y1918, c1919, x1920);
  h = fold(h, b1921, d1922, s1923, i1924, e1925, t1926, g1927, l1928, z1929, w1930, r1931, p1932, k1933, a1934, y1935, c1936, x1937);
  h = fold(h, b1938, d1939, s1940, i1941, e1942, t1943, g1944, l1945, z1946, w1947, r1948, p1949, k1950, a1951, y1952, c1953, x1954);
  h = fold(h, b1955, d1956, s1957, i1958, e1959, t1960, g1961, l1962, z1963, w1964, r1965, p1966, k1967, a1968, y1969, c1970, x1971);
  h = fold(h, b1972, d1973, s1974, i1975, e1976, t1977, g1978, l1979, z1980, w1981, r1982, p1983, k1984, a1985, y1986, c1987, x1988);
  h = ofBox(h, b1989); h = ofNumber(h, d1990); h = ofText(h, s1991); h = ofNumber(h, i1992); h = ofEither(h, e1993); h = ofFlag(h, t1994); h = ofBig(h, g1995); h = ofNumber(h, l1996); h = ofNumber(h, z1997); h = ofText(h, w1998); h = ofText(h, r1999);
  return h;
}

async function* takesAndStreams1(gate: Promise<number>, collects: boolean, b0: Box): StepsLater {
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  h = ofBox(h, b0);
  return h;
}
async function* takesAndStreams7(gate: Promise<number>, collects: boolean, b0: Box, d1: number, s2: string, i3: number, e4: Either, t5: boolean, g6: bigint): StepsLater {
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function* takesAndStreams40(gate: Promise<number>, collects: boolean, b0: Box, d1: number, s2: string, i3: number, e4: Either, t5: boolean, g6: bigint, l7: number, z8: number, w9: string, r10: string, p11: string, k12: Point, a13: number[], y14: symbol, c15: Adds, x16: any, b17: Box, d18: number, s19: string, i20: number, e21: Either, t22: boolean, g23: bigint, l24: number, z25: number, w26: string, r27: string, p28: string, k29: Point, a30: number[], y31: symbol, c32: Adds, x33: any, b34: Box, d35: number, s36: string, i37: number, e38: Either, t39: boolean): StepsLater {
  let h = await gate;
  h = mix(h, yield h);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}

async function awaitsWhenOld7(gate: Promise<number>, collects: boolean, aged: number = age()): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = mix(await gate, aged);
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function awaitsWhenOld40(gate: Promise<number>, collects: boolean, aged: number = age()): Promise<number> {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = mix(await gate, aged);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}

function* yieldsWhenOld7(seed: number, collects: boolean, aged: number = age()): Steps {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = mix(yield seed, aged);
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
function* yieldsWhenOld40(seed: number, collects: boolean, aged: number = age()): Steps {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = mix(yield seed, aged);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}

async function* streamsWhenOld7(gate: Promise<number>, collects: boolean, aged: number = age()): StepsLater {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big();
  let h = mix(await gate, aged);
  h = mix(h, yield h);
  if (collects) collect();
  h = ofBox(h, b0); h = ofNumber(h, d1); h = ofText(h, s2); h = ofNumber(h, i3); h = ofEither(h, e4); h = ofFlag(h, t5); h = ofBig(h, g6);
  return h;
}
async function* streamsWhenOld40(gate: Promise<number>, collects: boolean, aged: number = age()): StepsLater {
  const b0 = box(), d1 = fraction(), s2 = narrow(), i3 = int(), e4 = either(), t5 = flag(), g6 = big(), l7 = large(), z8 = special(), w9 = wide(), r10 = rope(), p11 = slice(), k12 = point(), a13 = list(), y14 = mark(), c15 = adder(), x16 = parsed();
  const b17 = box(), d18 = fraction(), s19 = narrow(), i20 = int(), e21 = either(), t22 = flag(), g23 = big(), l24 = large(), z25 = special(), w26 = wide(), r27 = rope(), p28 = slice(), k29 = point(), a30 = list(), y31 = mark(), c32 = adder(), x33 = parsed();
  const b34 = box(), d35 = fraction(), s36 = narrow(), i37 = int(), e38 = either(), t39 = flag();
  let h = mix(await gate, aged);
  h = mix(h, yield h);
  if (collects) collect();
  h = fold(h, b0, d1, s2, i3, e4, t5, g6, l7, z8, w9, r10, p11, k12, a13, y14, c15, x16);
  h = fold(h, b17, d18, s19, i20, e21, t22, g23, l24, z25, w26, r27, p28, k29, a30, y31, c32, x33);
  h = ofBox(h, b34); h = ofNumber(h, d35); h = ofText(h, s36); h = ofNumber(h, i37); h = ofEither(h, e38); h = ofFlag(h, t39);
  return h;
}

// What is freed by mistake is written over.
const ring: unknown[] = [];
function churn(): void {
  for (let i = 0; i < 20000; i++) ring[i & 255] = i & 1 ? { value: -i, text: "garbage" + i } : [i, i / 2, "g" + i];
}
function numberOfActivations(size: number): number {
  return size <= 7 ? 200 : size <= 40 ? 120 : size <= 300 ? 40 : 8;
}
const collectsWhenItGoesOn = (i: number): boolean => i % 64 === 3;

type StartsFunction = (gate: Promise<number>, collects: boolean) => Promise<number>;
type MakesGenerator = (seed: number, collects: boolean) => Steps;
type MakesAsyncGenerator = (gate: Promise<number>, collects: boolean) => StepsLater;

async function suspendFunctions(label: string, size: number, starts: StartsFunction): Promise<void> {
  const count = numberOfActivations(size);
  const opens: ((value: number) => void)[] = [];
  const gates: Promise<number>[] = [];
  const results: Promise<number>[] = [];
  const makeGates = (end: number): void => {
    while (gates.length < end) gates.push(new Promise<number>(resolve => opens.push(resolve)));
  };
  const start = (end: number): void => {
    makeGates(end);
    while (results.length < end) results.push(starts(gates[results.length], collectsWhenItGoesOn(results.length)));
  };
  let h = 0;
  start(count >> 1);
  collectYoung();
  start(count);
  collect();
  churn();
  for (let i = 0; i < count; i += 2) opens[i](i);
  for (let i = 0; i < count; i += 2) h = mix(h, await results[i]);
  // The next promises are old when they are awaited, and nothing else refers to the young frames that wait for them.
  makeGates(2 * count);
  collect();
  start(2 * count);
  collectYoung();
  // A frame that was freed by mistake is taken by one of these.
  start(2 * count + (count >> 1));
  churn();
  for (let i = results.length - 1; i >= 0; i--) if (i >= count || i % 2) opens[i](i);
  for (let i = 0; i < results.length; i++) if (i >= count || i % 2) h = mix(h, await results[i]);
  lines.push(label + ", keeps " + size + ": " + h);
}

function suspendGenerators(label: string, size: number, makes: MakesGenerator): void {
  const count = numberOfActivations(size);
  const made: (Steps | null)[] = [];
  const make = (end: number): void => {
    while (made.length < end) made.push(makes(made.length, collectsWhenItGoesOn(made.length)));
  };
  let h = 0;
  make(count >> 1);
  collectYoung();
  make(count);
  collect();
  churn();
  for (let i = 0; i < count; i += 2) h = mix(h, made[i]!.next(0).value);
  collect();
  churn();
  for (let i = 0; i < count; i += 2) {
    h = mix(h, made[i]!.next(i).value);
    made[i] = null;
  }
  collect();
  make(2 * count);
  collectYoung();
  make(2 * count + (count >> 1));
  churn();
  for (let i = made.length - 1; i >= 0; i--) if (made[i]) h = mix(h, made[i]!.next(0).value);
  collectYoung();
  churn();
  for (let i = 0; i < made.length; i++) if (made[i]) h = mix(h, made[i]!.next(i).value);
  lines.push(label + ", keeps " + size + ": " + h);
}

async function suspendAsyncGenerators(label: string, size: number, makes: MakesAsyncGenerator): Promise<void> {
  const count = numberOfActivations(size);
  const opens: ((value: number) => void)[] = [];
  const gates: Promise<number>[] = [];
  const made: (StepsLater | null)[] = [];
  let h = 0;
  const makeGates = (end: number): void => {
    while (gates.length < end) gates.push(new Promise<number>(resolve => opens.push(resolve)));
  };
  const make = (end: number): void => {
    makeGates(end);
    while (made.length < end) made.push(makes(gates[made.length], collectsWhenItGoesOn(made.length)));
  };
  const finish = async (chosen: number[]): Promise<void> => {
    const first = chosen.map(i => made[i]!.next(0));
    collectYoung();
    churn();
    for (const i of chosen) opens[i](i);
    for (const step of first) h = mix(h, (await step).value);
    collect();
    churn();
    for (const i of chosen) {
      h = mix(h, (await made[i]!.next(i)).value);
      made[i] = null;
    }
  };
  make(count >> 1);
  collectYoung();
  make(count);
  collect();
  churn();
  await finish(Array.from({ length: count >> 1 }, (_, i) => i * 2));
  makeGates(2 * count);
  collect();
  make(2 * count);
  collectYoung();
  make(2 * count + (count >> 1));
  churn();
  await finish(Array.from(made, (_, i) => made.length - 1 - i).filter(i => made[i] !== null));
  lines.push(label + ", keeps " + size + ": " + h);
}

const functions: [label: string, table: [size: number, starts: StartsFunction][]][] = [
  ["an async function that awaits a promise", [[0, awaits0], [1, awaits1], [7, awaits7], [40, awaits40], [300, awaits300], [2000, awaits2000]]],
  ["an async function that is awaited and awaits a promise", [[0, relays0], [1, relays1], [7, relays7], [40, relays40], [300, relays300], [2000, relays2000]]],
  ["an async function that awaits a call", [[0, awaitsCall0], [1, awaitsCall1], [7, awaitsCall7], [40, awaitsCall40], [300, awaitsCall300], [2000, awaitsCall2000]]],
  ["an async function that loops over an async generator", [[0, loopsOverStream0], [1, loopsOverStream1], [7, loopsOverStream7], [40, loopsOverStream40], [300, loopsOverStream300]]],
  ["an async function that loops over an array with for await", [[0, loopsOverList0], [1, loopsOverList1], [7, loopsOverList7], [40, loopsOverList40], [300, loopsOverList300]]],
  ["an async function that collects in its parameters", [[7, awaitsWhenOld7], [40, awaitsWhenOld40]]],
];
const functionsWithParameters: [size: number, starts: StartsFunction][] = [
  [1, (gate, collects) => takesAndAwaits1(gate, collects, box())],
  [7, (gate, collects) => takesAndAwaits7(gate, collects, box(), fraction(), narrow(), int(), either(), flag(), big())],
  [40, (gate, collects) => takesAndAwaits40(gate, collects, box(), fraction(), narrow(), int(), either(), flag(), big(), large(), special(), wide(), rope(), slice(), point(), list(), mark(), adder(), parsed(), box(), fraction(), narrow(), int(), either(), flag(), big(), large(), special(), wide(), rope(), slice(), point(), list(), mark(), adder(), parsed(), box(), fraction(), narrow(), int(), either(), flag())],
];
const generators: [size: number, makes: MakesGenerator][] = [[0, yields0], [1, yields1], [7, yields7], [40, yields40], [300, yields300], [2000, yields2000]];
const generatorsThatCollect: [size: number, makes: MakesGenerator][] = [[7, yieldsWhenOld7], [40, yieldsWhenOld40]];
const generatorsWithParameters: [size: number, makes: MakesGenerator][] = [
  [1, (seed, collects) => takesAndYields1(seed, collects, box())],
  [7, (seed, collects) => takesAndYields7(seed, collects, box(), fraction(), narrow(), int(), either(), flag(), big())],
  [40, (seed, collects) => takesAndYields40(seed, collects, box(), fraction(), narrow(), int(), either(), flag(), big(), large(), special(), wide(), rope(), slice(), point(), list(), mark(), adder(), parsed(), box(), fraction(), narrow(), int(), either(), flag(), big(), large(), special(), wide(), rope(), slice(), point(), list(), mark(), adder(), parsed(), box(), fraction(), narrow(), int(), either(), flag())],
];
const asyncGenerators: [size: number, makes: MakesAsyncGenerator][] = [[0, streams0], [1, streams1], [7, streams7], [40, streams40], [300, streams300], [2000, streams2000]];
const asyncGeneratorsThatCollect: [size: number, makes: MakesAsyncGenerator][] = [[7, streamsWhenOld7], [40, streamsWhenOld40]];
const asyncGeneratorsWithParameters: [size: number, makes: MakesAsyncGenerator][] = [
  [1, (gate, collects) => takesAndStreams1(gate, collects, box())],
  [7, (gate, collects) => takesAndStreams7(gate, collects, box(), fraction(), narrow(), int(), either(), flag(), big())],
  [40, (gate, collects) => takesAndStreams40(gate, collects, box(), fraction(), narrow(), int(), either(), flag(), big(), large(), special(), wide(), rope(), slice(), point(), list(), mark(), adder(), parsed(), box(), fraction(), narrow(), int(), either(), flag(), big(), large(), special(), wide(), rope(), slice(), point(), list(), mark(), adder(), parsed(), box(), fraction(), narrow(), int(), either(), flag())],
];

for (const [label, table] of functions) for (const [size, starts] of table) await suspendFunctions(label, size, starts);
for (const [size, starts] of functionsWithParameters) await suspendFunctions("an async function that takes them as parameters", size, starts);
for (const [size, makes] of generators) suspendGenerators("a generator", size, makes);
for (const [size, makes] of generatorsWithParameters) suspendGenerators("a generator that takes them as parameters", size, makes);
for (const [size, makes] of generatorsThatCollect) suspendGenerators("a generator that collects in its parameters", size, makes);
for (const [size, makes] of asyncGenerators) await suspendAsyncGenerators("an async generator", size, makes);
for (const [size, makes] of asyncGeneratorsWithParameters) await suspendAsyncGenerators("an async generator that takes them as parameters", size, makes);
for (const [size, makes] of asyncGeneratorsThatCollect) await suspendAsyncGenerators("an async generator that collects in its parameters", size, makes);
console.log(lines.join("\n"));

export {};
