// Generated program: object and closure identity stays observable when allocations are removed (second series, part 4).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R241 { a241: number; m241: () => number }
function make241(): R241 { return { a241: 1, m241: () => 1 }; }
function c241(): void { say("record/reduce/includes", [([make241().m241 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))].includes(([make241().m241 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)))); }

interface R242 { a242: number; m242: () => number }
function make242(): R242 { return { a242: 1, m242: () => 1 }; }
function c242(): void { say("record/reduce/index-of", [([make242().m242 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))].indexOf(([make242().m242 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)))); }

interface R243 { a243: number; m243: () => number }
function make243(): R243 { return { a243: 1, m243: () => 1 }; }
const ws243 = new WeakSet<object>();
function c243(): void { say("record/reduce/weak-set", (ws243.add(([make243().m243 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) as object), ws243.has(([make243().m243 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) as object))); }

interface R244 { a244: number; m244: () => number }
function make244(): R244 { return { a244: 1, m244: () => 1 }; }
const wm244 = new WeakMap<object, number>();
function c244(): void { say("record/reduce/weak-map", (wm244.set(([make244().m244 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) as object, 1), wm244.has(([make244().m244 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) as object))); }

interface R245 { a245: number; m245: () => number }
function make245(): R245 { return { a245: 1, m245: () => 1 }; }
function c245(): void { say("record/reduce/written", (((([make245().m245 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))) as any).tag = 1, ((([make245().m245 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))) as any).tag)); }

interface R246 { a246: number; m246: () => number }
function make246(): R246 { return { a246: 1, m246: () => 1 }; }
function c246(): void { say("record/reduce/defined", (Object.defineProperty(([make246().m246 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) as object, "t", { value: 1 }), "t" in (([make246().m246 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) as object))); }

interface R247 { a247: number; m247: () => number }
function make247(): R247 { return { a247: 1, m247: () => 1 }; }
function c247(): void { say("record/reduce/frozen", (Object.freeze(([make247().m247 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))), Object.isFrozen(([make247().m247 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))))); }

interface R248 { a248: number; m248: () => number }
function make248(): R248 { return { a248: 1, m248: () => 1 }; }
function c248(): void { say("record/reduce/prototype-set", (Object.setPrototypeOf(([make248().m248 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) as object, null), Object.getPrototypeOf(([make248().m248 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))) === null)); }

interface R249 { a249: number; m249: () => number }
function make249(): R249 { return { a249: 1, m249: () => 1 }; }
function c249(): void { say("record/reduce/deleted", (delete ((([make249().m249 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))) as any).length, Object.hasOwn(([make249().m249 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) as object, "length"))); }

interface R250 { a250: number; m250: () => number }
function make250(): R250 { return { a250: 1, m250: () => 1 }; }
function same250(a: unknown, b: unknown): boolean { return a === b; }
function c250(): void { say("record/reduce/in-a-callee", same250(([make250().m250 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)), ([make250().m250 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)))); }

interface R251 { a251: number; m251: () => number }
function make251(): R251 { return { a251: 1, m251: () => 1 }; }
function hit251(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c251(): void { say("record/reduce/switch", hit251(([make251().m251 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)), ([make251().m251 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)))); }

interface R252 { a252: number; m252: () => number }
function make252(): R252 { return { a252: 1, m252: () => 1 }; }
let last252: unknown;
function seen252(f: unknown): boolean { const same = f === last252; last252 = f; return same; }
function c252(): void { say("record/reduce/kept-then-compared", (seen252(([make252().m252 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))), seen252(([make252().m252 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))))); }

interface R253 { a253: number; m253: () => number }
function make253(): R253 { return { a253: 1, m253: () => 1 }; }
function c253(): void { say("record/filter/strict-eq", ([make253().m253].filter(() => true)[0]) === ([make253().m253].filter(() => true)[0])); }

interface R254 { a254: number; m254: () => number }
function make254(): R254 { return { a254: 1, m254: () => 1 }; }
function c254(): void { say("record/filter/strict-ne", ([make254().m254].filter(() => true)[0]) !== ([make254().m254].filter(() => true)[0])); }

interface R255 { a255: number; m255: () => number }
function make255(): R255 { return { a255: 1, m255: () => 1 }; }
function c255(): void { say("record/filter/loose-eq", ([make255().m255].filter(() => true)[0]) == ([make255().m255].filter(() => true)[0])); }

interface R256 { a256: number; m256: () => number }
function make256(): R256 { return { a256: 1, m256: () => 1 }; }
function c256(): void { say("record/filter/object-is", Object.is(([make256().m256].filter(() => true)[0]), ([make256().m256].filter(() => true)[0]))); }

interface R257 { a257: number; m257: () => number }
function make257(): R257 { return { a257: 1, m257: () => 1 }; }
function c257(): void { say("record/filter/set", new Set([([make257().m257].filter(() => true)[0]), ([make257().m257].filter(() => true)[0])]).size); }

interface R258 { a258: number; m258: () => number }
function make258(): R258 { return { a258: 1, m258: () => 1 }; }
function c258(): void { say("record/filter/map-key", new Map([[([make258().m258].filter(() => true)[0]), 1], [([make258().m258].filter(() => true)[0]), 2]]).size); }

interface R259 { a259: number; m259: () => number }
function make259(): R259 { return { a259: 1, m259: () => 1 }; }
function c259(): void { say("record/filter/includes", [([make259().m259].filter(() => true)[0])].includes(([make259().m259].filter(() => true)[0]))); }

interface R260 { a260: number; m260: () => number }
function make260(): R260 { return { a260: 1, m260: () => 1 }; }
function c260(): void { say("record/filter/index-of", [([make260().m260].filter(() => true)[0])].indexOf(([make260().m260].filter(() => true)[0]))); }

interface R261 { a261: number; m261: () => number }
function make261(): R261 { return { a261: 1, m261: () => 1 }; }
const ws261 = new WeakSet<object>();
function c261(): void { say("record/filter/weak-set", (ws261.add(([make261().m261].filter(() => true)[0]) as object), ws261.has(([make261().m261].filter(() => true)[0]) as object))); }

interface R262 { a262: number; m262: () => number }
function make262(): R262 { return { a262: 1, m262: () => 1 }; }
const wm262 = new WeakMap<object, number>();
function c262(): void { say("record/filter/weak-map", (wm262.set(([make262().m262].filter(() => true)[0]) as object, 1), wm262.has(([make262().m262].filter(() => true)[0]) as object))); }

interface R263 { a263: number; m263: () => number }
function make263(): R263 { return { a263: 1, m263: () => 1 }; }
function c263(): void { say("record/filter/written", (((([make263().m263].filter(() => true)[0])) as any).tag = 1, ((([make263().m263].filter(() => true)[0])) as any).tag)); }

interface R264 { a264: number; m264: () => number }
function make264(): R264 { return { a264: 1, m264: () => 1 }; }
function c264(): void { say("record/filter/defined", (Object.defineProperty(([make264().m264].filter(() => true)[0]) as object, "t", { value: 1 }), "t" in (([make264().m264].filter(() => true)[0]) as object))); }

interface R265 { a265: number; m265: () => number }
function make265(): R265 { return { a265: 1, m265: () => 1 }; }
function c265(): void { say("record/filter/frozen", (Object.freeze(([make265().m265].filter(() => true)[0])), Object.isFrozen(([make265().m265].filter(() => true)[0])))); }

interface R266 { a266: number; m266: () => number }
function make266(): R266 { return { a266: 1, m266: () => 1 }; }
function c266(): void { say("record/filter/prototype-set", (Object.setPrototypeOf(([make266().m266].filter(() => true)[0]) as object, null), Object.getPrototypeOf(([make266().m266].filter(() => true)[0])) === null)); }

interface R267 { a267: number; m267: () => number }
function make267(): R267 { return { a267: 1, m267: () => 1 }; }
function c267(): void { say("record/filter/deleted", (delete ((([make267().m267].filter(() => true)[0])) as any).length, Object.hasOwn(([make267().m267].filter(() => true)[0]) as object, "length"))); }

interface R268 { a268: number; m268: () => number }
function make268(): R268 { return { a268: 1, m268: () => 1 }; }
function same268(a: unknown, b: unknown): boolean { return a === b; }
function c268(): void { say("record/filter/in-a-callee", same268(([make268().m268].filter(() => true)[0]), ([make268().m268].filter(() => true)[0]))); }

interface R269 { a269: number; m269: () => number }
function make269(): R269 { return { a269: 1, m269: () => 1 }; }
function hit269(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c269(): void { say("record/filter/switch", hit269(([make269().m269].filter(() => true)[0]), ([make269().m269].filter(() => true)[0]))); }

interface R270 { a270: number; m270: () => number }
function make270(): R270 { return { a270: 1, m270: () => 1 }; }
let last270: unknown;
function seen270(f: unknown): boolean { const same = f === last270; last270 = f; return same; }
function c270(): void { say("record/filter/kept-then-compared", (seen270(([make270().m270].filter(() => true)[0])), seen270(([make270().m270].filter(() => true)[0])))); }

interface R271 { a271: number; m271: () => number }
function make271(): R271 { return { a271: 1, m271: () => 1 }; }
function c271(): void { say("record/flat/strict-eq", ([[make271().m271]].flat()[0]) === ([[make271().m271]].flat()[0])); }

interface R272 { a272: number; m272: () => number }
function make272(): R272 { return { a272: 1, m272: () => 1 }; }
function c272(): void { say("record/flat/strict-ne", ([[make272().m272]].flat()[0]) !== ([[make272().m272]].flat()[0])); }

interface R273 { a273: number; m273: () => number }
function make273(): R273 { return { a273: 1, m273: () => 1 }; }
function c273(): void { say("record/flat/loose-eq", ([[make273().m273]].flat()[0]) == ([[make273().m273]].flat()[0])); }

interface R274 { a274: number; m274: () => number }
function make274(): R274 { return { a274: 1, m274: () => 1 }; }
function c274(): void { say("record/flat/object-is", Object.is(([[make274().m274]].flat()[0]), ([[make274().m274]].flat()[0]))); }

interface R275 { a275: number; m275: () => number }
function make275(): R275 { return { a275: 1, m275: () => 1 }; }
function c275(): void { say("record/flat/set", new Set([([[make275().m275]].flat()[0]), ([[make275().m275]].flat()[0])]).size); }

interface R276 { a276: number; m276: () => number }
function make276(): R276 { return { a276: 1, m276: () => 1 }; }
function c276(): void { say("record/flat/map-key", new Map([[([[make276().m276]].flat()[0]), 1], [([[make276().m276]].flat()[0]), 2]]).size); }

interface R277 { a277: number; m277: () => number }
function make277(): R277 { return { a277: 1, m277: () => 1 }; }
function c277(): void { say("record/flat/includes", [([[make277().m277]].flat()[0])].includes(([[make277().m277]].flat()[0]))); }

interface R278 { a278: number; m278: () => number }
function make278(): R278 { return { a278: 1, m278: () => 1 }; }
function c278(): void { say("record/flat/index-of", [([[make278().m278]].flat()[0])].indexOf(([[make278().m278]].flat()[0]))); }

interface R279 { a279: number; m279: () => number }
function make279(): R279 { return { a279: 1, m279: () => 1 }; }
const ws279 = new WeakSet<object>();
function c279(): void { say("record/flat/weak-set", (ws279.add(([[make279().m279]].flat()[0]) as object), ws279.has(([[make279().m279]].flat()[0]) as object))); }

interface R280 { a280: number; m280: () => number }
function make280(): R280 { return { a280: 1, m280: () => 1 }; }
const wm280 = new WeakMap<object, number>();
function c280(): void { say("record/flat/weak-map", (wm280.set(([[make280().m280]].flat()[0]) as object, 1), wm280.has(([[make280().m280]].flat()[0]) as object))); }

interface R281 { a281: number; m281: () => number }
function make281(): R281 { return { a281: 1, m281: () => 1 }; }
function c281(): void { say("record/flat/written", (((([[make281().m281]].flat()[0])) as any).tag = 1, ((([[make281().m281]].flat()[0])) as any).tag)); }

interface R282 { a282: number; m282: () => number }
function make282(): R282 { return { a282: 1, m282: () => 1 }; }
function c282(): void { say("record/flat/defined", (Object.defineProperty(([[make282().m282]].flat()[0]) as object, "t", { value: 1 }), "t" in (([[make282().m282]].flat()[0]) as object))); }

interface R283 { a283: number; m283: () => number }
function make283(): R283 { return { a283: 1, m283: () => 1 }; }
function c283(): void { say("record/flat/frozen", (Object.freeze(([[make283().m283]].flat()[0])), Object.isFrozen(([[make283().m283]].flat()[0])))); }

interface R284 { a284: number; m284: () => number }
function make284(): R284 { return { a284: 1, m284: () => 1 }; }
function c284(): void { say("record/flat/prototype-set", (Object.setPrototypeOf(([[make284().m284]].flat()[0]) as object, null), Object.getPrototypeOf(([[make284().m284]].flat()[0])) === null)); }

interface R285 { a285: number; m285: () => number }
function make285(): R285 { return { a285: 1, m285: () => 1 }; }
function c285(): void { say("record/flat/deleted", (delete ((([[make285().m285]].flat()[0])) as any).length, Object.hasOwn(([[make285().m285]].flat()[0]) as object, "length"))); }

interface R286 { a286: number; m286: () => number }
function make286(): R286 { return { a286: 1, m286: () => 1 }; }
function same286(a: unknown, b: unknown): boolean { return a === b; }
function c286(): void { say("record/flat/in-a-callee", same286(([[make286().m286]].flat()[0]), ([[make286().m286]].flat()[0]))); }

interface R287 { a287: number; m287: () => number }
function make287(): R287 { return { a287: 1, m287: () => 1 }; }
function hit287(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c287(): void { say("record/flat/switch", hit287(([[make287().m287]].flat()[0]), ([[make287().m287]].flat()[0]))); }

interface R288 { a288: number; m288: () => number }
function make288(): R288 { return { a288: 1, m288: () => 1 }; }
let last288: unknown;
function seen288(f: unknown): boolean { const same = f === last288; last288 = f; return same; }
function c288(): void { say("record/flat/kept-then-compared", (seen288(([[make288().m288]].flat()[0])), seen288(([[make288().m288]].flat()[0])))); }

interface R289 { a289: number; m289: () => number }
function make289(): R289 { return { a289: 1, m289: () => 1 }; }
function c289(): void { say("record/at/strict-eq", ([make289().m289].at(0)) === ([make289().m289].at(0))); }

interface R290 { a290: number; m290: () => number }
function make290(): R290 { return { a290: 1, m290: () => 1 }; }
function c290(): void { say("record/at/strict-ne", ([make290().m290].at(0)) !== ([make290().m290].at(0))); }

interface R291 { a291: number; m291: () => number }
function make291(): R291 { return { a291: 1, m291: () => 1 }; }
function c291(): void { say("record/at/loose-eq", ([make291().m291].at(0)) == ([make291().m291].at(0))); }

interface R292 { a292: number; m292: () => number }
function make292(): R292 { return { a292: 1, m292: () => 1 }; }
function c292(): void { say("record/at/object-is", Object.is(([make292().m292].at(0)), ([make292().m292].at(0)))); }

interface R293 { a293: number; m293: () => number }
function make293(): R293 { return { a293: 1, m293: () => 1 }; }
function c293(): void { say("record/at/set", new Set([([make293().m293].at(0)), ([make293().m293].at(0))]).size); }

interface R294 { a294: number; m294: () => number }
function make294(): R294 { return { a294: 1, m294: () => 1 }; }
function c294(): void { say("record/at/map-key", new Map([[([make294().m294].at(0)), 1], [([make294().m294].at(0)), 2]]).size); }

interface R295 { a295: number; m295: () => number }
function make295(): R295 { return { a295: 1, m295: () => 1 }; }
function c295(): void { say("record/at/includes", [([make295().m295].at(0))].includes(([make295().m295].at(0)))); }

interface R296 { a296: number; m296: () => number }
function make296(): R296 { return { a296: 1, m296: () => 1 }; }
function c296(): void { say("record/at/index-of", [([make296().m296].at(0))].indexOf(([make296().m296].at(0)))); }

interface R297 { a297: number; m297: () => number }
function make297(): R297 { return { a297: 1, m297: () => 1 }; }
const ws297 = new WeakSet<object>();
function c297(): void { say("record/at/weak-set", (ws297.add(([make297().m297].at(0)) as object), ws297.has(([make297().m297].at(0)) as object))); }

interface R298 { a298: number; m298: () => number }
function make298(): R298 { return { a298: 1, m298: () => 1 }; }
const wm298 = new WeakMap<object, number>();
function c298(): void { say("record/at/weak-map", (wm298.set(([make298().m298].at(0)) as object, 1), wm298.has(([make298().m298].at(0)) as object))); }

interface R299 { a299: number; m299: () => number }
function make299(): R299 { return { a299: 1, m299: () => 1 }; }
function c299(): void { say("record/at/written", (((([make299().m299].at(0))) as any).tag = 1, ((([make299().m299].at(0))) as any).tag)); }

interface R300 { a300: number; m300: () => number }
function make300(): R300 { return { a300: 1, m300: () => 1 }; }
function c300(): void { say("record/at/defined", (Object.defineProperty(([make300().m300].at(0)) as object, "t", { value: 1 }), "t" in (([make300().m300].at(0)) as object))); }

c241(); c242(); c243(); c244(); c245(); c246(); c247(); c248(); c249(); c250(); c251(); c252(); c253(); c254(); c255(); c256(); c257(); c258(); c259(); c260(); c261(); c262(); c263(); c264(); c265(); c266(); c267(); c268(); c269(); c270(); c271(); c272(); c273(); c274(); c275(); c276(); c277(); c278(); c279(); c280(); c281(); c282(); c283(); c284(); c285(); c286(); c287(); c288(); c289(); c290(); c291(); c292(); c293(); c294(); c295(); c296(); c297(); c298(); c299(); c300();
console.log(out.join("\n"));
