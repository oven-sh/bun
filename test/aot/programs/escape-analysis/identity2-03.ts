// Generated program: object and closure identity stays observable when allocations are removed (second series, part 3).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R181 { a181: number; m181: () => number }
function make181(): R181 { return { a181: 1, m181: () => 1 }; }
function get181(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make181().m181; } }; for (const f of it) return f; return 0; }
function c181(): void { say("record/custom-iterable/strict-eq", (get181()) === (get181())); }

interface R182 { a182: number; m182: () => number }
function make182(): R182 { return { a182: 1, m182: () => 1 }; }
function get182(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make182().m182; } }; for (const f of it) return f; return 0; }
function c182(): void { say("record/custom-iterable/strict-ne", (get182()) !== (get182())); }

interface R183 { a183: number; m183: () => number }
function make183(): R183 { return { a183: 1, m183: () => 1 }; }
function get183(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make183().m183; } }; for (const f of it) return f; return 0; }
function c183(): void { say("record/custom-iterable/loose-eq", (get183()) == (get183())); }

interface R184 { a184: number; m184: () => number }
function make184(): R184 { return { a184: 1, m184: () => 1 }; }
function get184(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make184().m184; } }; for (const f of it) return f; return 0; }
function c184(): void { say("record/custom-iterable/object-is", Object.is((get184()), (get184()))); }

interface R185 { a185: number; m185: () => number }
function make185(): R185 { return { a185: 1, m185: () => 1 }; }
function get185(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make185().m185; } }; for (const f of it) return f; return 0; }
function c185(): void { say("record/custom-iterable/set", new Set([(get185()), (get185())]).size); }

interface R186 { a186: number; m186: () => number }
function make186(): R186 { return { a186: 1, m186: () => 1 }; }
function get186(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make186().m186; } }; for (const f of it) return f; return 0; }
function c186(): void { say("record/custom-iterable/map-key", new Map([[(get186()), 1], [(get186()), 2]]).size); }

interface R187 { a187: number; m187: () => number }
function make187(): R187 { return { a187: 1, m187: () => 1 }; }
function get187(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make187().m187; } }; for (const f of it) return f; return 0; }
function c187(): void { say("record/custom-iterable/includes", [(get187())].includes((get187()))); }

interface R188 { a188: number; m188: () => number }
function make188(): R188 { return { a188: 1, m188: () => 1 }; }
function get188(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make188().m188; } }; for (const f of it) return f; return 0; }
function c188(): void { say("record/custom-iterable/index-of", [(get188())].indexOf((get188()))); }

interface R189 { a189: number; m189: () => number }
function make189(): R189 { return { a189: 1, m189: () => 1 }; }
function get189(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make189().m189; } }; for (const f of it) return f; return 0; }
const ws189 = new WeakSet<object>();
function c189(): void { say("record/custom-iterable/weak-set", (ws189.add((get189()) as object), ws189.has((get189()) as object))); }

interface R190 { a190: number; m190: () => number }
function make190(): R190 { return { a190: 1, m190: () => 1 }; }
function get190(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make190().m190; } }; for (const f of it) return f; return 0; }
const wm190 = new WeakMap<object, number>();
function c190(): void { say("record/custom-iterable/weak-map", (wm190.set((get190()) as object, 1), wm190.has((get190()) as object))); }

interface R191 { a191: number; m191: () => number }
function make191(): R191 { return { a191: 1, m191: () => 1 }; }
function get191(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make191().m191; } }; for (const f of it) return f; return 0; }
function c191(): void { say("record/custom-iterable/written", ((((get191())) as any).tag = 1, (((get191())) as any).tag)); }

interface R192 { a192: number; m192: () => number }
function make192(): R192 { return { a192: 1, m192: () => 1 }; }
function get192(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make192().m192; } }; for (const f of it) return f; return 0; }
function c192(): void { say("record/custom-iterable/defined", (Object.defineProperty((get192()) as object, "t", { value: 1 }), "t" in ((get192()) as object))); }

interface R193 { a193: number; m193: () => number }
function make193(): R193 { return { a193: 1, m193: () => 1 }; }
function get193(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make193().m193; } }; for (const f of it) return f; return 0; }
function c193(): void { say("record/custom-iterable/frozen", (Object.freeze((get193())), Object.isFrozen((get193())))); }

interface R194 { a194: number; m194: () => number }
function make194(): R194 { return { a194: 1, m194: () => 1 }; }
function get194(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make194().m194; } }; for (const f of it) return f; return 0; }
function c194(): void { say("record/custom-iterable/prototype-set", (Object.setPrototypeOf((get194()) as object, null), Object.getPrototypeOf((get194())) === null)); }

interface R195 { a195: number; m195: () => number }
function make195(): R195 { return { a195: 1, m195: () => 1 }; }
function get195(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make195().m195; } }; for (const f of it) return f; return 0; }
function c195(): void { say("record/custom-iterable/deleted", (delete (((get195())) as any).length, Object.hasOwn((get195()) as object, "length"))); }

interface R196 { a196: number; m196: () => number }
function make196(): R196 { return { a196: 1, m196: () => 1 }; }
function get196(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make196().m196; } }; for (const f of it) return f; return 0; }
function same196(a: unknown, b: unknown): boolean { return a === b; }
function c196(): void { say("record/custom-iterable/in-a-callee", same196((get196()), (get196()))); }

interface R197 { a197: number; m197: () => number }
function make197(): R197 { return { a197: 1, m197: () => 1 }; }
function get197(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make197().m197; } }; for (const f of it) return f; return 0; }
function hit197(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c197(): void { say("record/custom-iterable/switch", hit197((get197()), (get197()))); }

interface R198 { a198: number; m198: () => number }
function make198(): R198 { return { a198: 1, m198: () => 1 }; }
function get198(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make198().m198; } }; for (const f of it) return f; return 0; }
let last198: unknown;
function seen198(f: unknown): boolean { const same = f === last198; last198 = f; return same; }
function c198(): void { say("record/custom-iterable/kept-then-compared", (seen198((get198())), seen198((get198())))); }

interface R199 { a199: number; m199: () => number }
function make199(): R199 { return { a199: 1, m199: () => 1 }; }
function c199(): void { say("record/map-callback/strict-eq", ([0].map(() => make199().m199)[0]) === ([0].map(() => make199().m199)[0])); }

interface R200 { a200: number; m200: () => number }
function make200(): R200 { return { a200: 1, m200: () => 1 }; }
function c200(): void { say("record/map-callback/strict-ne", ([0].map(() => make200().m200)[0]) !== ([0].map(() => make200().m200)[0])); }

interface R201 { a201: number; m201: () => number }
function make201(): R201 { return { a201: 1, m201: () => 1 }; }
function c201(): void { say("record/map-callback/loose-eq", ([0].map(() => make201().m201)[0]) == ([0].map(() => make201().m201)[0])); }

interface R202 { a202: number; m202: () => number }
function make202(): R202 { return { a202: 1, m202: () => 1 }; }
function c202(): void { say("record/map-callback/object-is", Object.is(([0].map(() => make202().m202)[0]), ([0].map(() => make202().m202)[0]))); }

interface R203 { a203: number; m203: () => number }
function make203(): R203 { return { a203: 1, m203: () => 1 }; }
function c203(): void { say("record/map-callback/set", new Set([([0].map(() => make203().m203)[0]), ([0].map(() => make203().m203)[0])]).size); }

interface R204 { a204: number; m204: () => number }
function make204(): R204 { return { a204: 1, m204: () => 1 }; }
function c204(): void { say("record/map-callback/map-key", new Map([[([0].map(() => make204().m204)[0]), 1], [([0].map(() => make204().m204)[0]), 2]]).size); }

interface R205 { a205: number; m205: () => number }
function make205(): R205 { return { a205: 1, m205: () => 1 }; }
function c205(): void { say("record/map-callback/includes", [([0].map(() => make205().m205)[0])].includes(([0].map(() => make205().m205)[0]))); }

interface R206 { a206: number; m206: () => number }
function make206(): R206 { return { a206: 1, m206: () => 1 }; }
function c206(): void { say("record/map-callback/index-of", [([0].map(() => make206().m206)[0])].indexOf(([0].map(() => make206().m206)[0]))); }

interface R207 { a207: number; m207: () => number }
function make207(): R207 { return { a207: 1, m207: () => 1 }; }
const ws207 = new WeakSet<object>();
function c207(): void { say("record/map-callback/weak-set", (ws207.add(([0].map(() => make207().m207)[0]) as object), ws207.has(([0].map(() => make207().m207)[0]) as object))); }

interface R208 { a208: number; m208: () => number }
function make208(): R208 { return { a208: 1, m208: () => 1 }; }
const wm208 = new WeakMap<object, number>();
function c208(): void { say("record/map-callback/weak-map", (wm208.set(([0].map(() => make208().m208)[0]) as object, 1), wm208.has(([0].map(() => make208().m208)[0]) as object))); }

interface R209 { a209: number; m209: () => number }
function make209(): R209 { return { a209: 1, m209: () => 1 }; }
function c209(): void { say("record/map-callback/written", (((([0].map(() => make209().m209)[0])) as any).tag = 1, ((([0].map(() => make209().m209)[0])) as any).tag)); }

interface R210 { a210: number; m210: () => number }
function make210(): R210 { return { a210: 1, m210: () => 1 }; }
function c210(): void { say("record/map-callback/defined", (Object.defineProperty(([0].map(() => make210().m210)[0]) as object, "t", { value: 1 }), "t" in (([0].map(() => make210().m210)[0]) as object))); }

interface R211 { a211: number; m211: () => number }
function make211(): R211 { return { a211: 1, m211: () => 1 }; }
function c211(): void { say("record/map-callback/frozen", (Object.freeze(([0].map(() => make211().m211)[0])), Object.isFrozen(([0].map(() => make211().m211)[0])))); }

interface R212 { a212: number; m212: () => number }
function make212(): R212 { return { a212: 1, m212: () => 1 }; }
function c212(): void { say("record/map-callback/prototype-set", (Object.setPrototypeOf(([0].map(() => make212().m212)[0]) as object, null), Object.getPrototypeOf(([0].map(() => make212().m212)[0])) === null)); }

interface R213 { a213: number; m213: () => number }
function make213(): R213 { return { a213: 1, m213: () => 1 }; }
function c213(): void { say("record/map-callback/deleted", (delete ((([0].map(() => make213().m213)[0])) as any).length, Object.hasOwn(([0].map(() => make213().m213)[0]) as object, "length"))); }

interface R214 { a214: number; m214: () => number }
function make214(): R214 { return { a214: 1, m214: () => 1 }; }
function same214(a: unknown, b: unknown): boolean { return a === b; }
function c214(): void { say("record/map-callback/in-a-callee", same214(([0].map(() => make214().m214)[0]), ([0].map(() => make214().m214)[0]))); }

interface R215 { a215: number; m215: () => number }
function make215(): R215 { return { a215: 1, m215: () => 1 }; }
function hit215(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c215(): void { say("record/map-callback/switch", hit215(([0].map(() => make215().m215)[0]), ([0].map(() => make215().m215)[0]))); }

interface R216 { a216: number; m216: () => number }
function make216(): R216 { return { a216: 1, m216: () => 1 }; }
let last216: unknown;
function seen216(f: unknown): boolean { const same = f === last216; last216 = f; return same; }
function c216(): void { say("record/map-callback/kept-then-compared", (seen216(([0].map(() => make216().m216)[0])), seen216(([0].map(() => make216().m216)[0])))); }

interface R217 { a217: number; m217: () => number }
function make217(): R217 { return { a217: 1, m217: () => 1 }; }
function c217(): void { say("record/find/strict-eq", ([make217().m217].find(() => true)) === ([make217().m217].find(() => true))); }

interface R218 { a218: number; m218: () => number }
function make218(): R218 { return { a218: 1, m218: () => 1 }; }
function c218(): void { say("record/find/strict-ne", ([make218().m218].find(() => true)) !== ([make218().m218].find(() => true))); }

interface R219 { a219: number; m219: () => number }
function make219(): R219 { return { a219: 1, m219: () => 1 }; }
function c219(): void { say("record/find/loose-eq", ([make219().m219].find(() => true)) == ([make219().m219].find(() => true))); }

interface R220 { a220: number; m220: () => number }
function make220(): R220 { return { a220: 1, m220: () => 1 }; }
function c220(): void { say("record/find/object-is", Object.is(([make220().m220].find(() => true)), ([make220().m220].find(() => true)))); }

interface R221 { a221: number; m221: () => number }
function make221(): R221 { return { a221: 1, m221: () => 1 }; }
function c221(): void { say("record/find/set", new Set([([make221().m221].find(() => true)), ([make221().m221].find(() => true))]).size); }

interface R222 { a222: number; m222: () => number }
function make222(): R222 { return { a222: 1, m222: () => 1 }; }
function c222(): void { say("record/find/map-key", new Map([[([make222().m222].find(() => true)), 1], [([make222().m222].find(() => true)), 2]]).size); }

interface R223 { a223: number; m223: () => number }
function make223(): R223 { return { a223: 1, m223: () => 1 }; }
function c223(): void { say("record/find/includes", [([make223().m223].find(() => true))].includes(([make223().m223].find(() => true)))); }

interface R224 { a224: number; m224: () => number }
function make224(): R224 { return { a224: 1, m224: () => 1 }; }
function c224(): void { say("record/find/index-of", [([make224().m224].find(() => true))].indexOf(([make224().m224].find(() => true)))); }

interface R225 { a225: number; m225: () => number }
function make225(): R225 { return { a225: 1, m225: () => 1 }; }
const ws225 = new WeakSet<object>();
function c225(): void { say("record/find/weak-set", (ws225.add(([make225().m225].find(() => true)) as object), ws225.has(([make225().m225].find(() => true)) as object))); }

interface R226 { a226: number; m226: () => number }
function make226(): R226 { return { a226: 1, m226: () => 1 }; }
const wm226 = new WeakMap<object, number>();
function c226(): void { say("record/find/weak-map", (wm226.set(([make226().m226].find(() => true)) as object, 1), wm226.has(([make226().m226].find(() => true)) as object))); }

interface R227 { a227: number; m227: () => number }
function make227(): R227 { return { a227: 1, m227: () => 1 }; }
function c227(): void { say("record/find/written", (((([make227().m227].find(() => true))) as any).tag = 1, ((([make227().m227].find(() => true))) as any).tag)); }

interface R228 { a228: number; m228: () => number }
function make228(): R228 { return { a228: 1, m228: () => 1 }; }
function c228(): void { say("record/find/defined", (Object.defineProperty(([make228().m228].find(() => true)) as object, "t", { value: 1 }), "t" in (([make228().m228].find(() => true)) as object))); }

interface R229 { a229: number; m229: () => number }
function make229(): R229 { return { a229: 1, m229: () => 1 }; }
function c229(): void { say("record/find/frozen", (Object.freeze(([make229().m229].find(() => true))), Object.isFrozen(([make229().m229].find(() => true))))); }

interface R230 { a230: number; m230: () => number }
function make230(): R230 { return { a230: 1, m230: () => 1 }; }
function c230(): void { say("record/find/prototype-set", (Object.setPrototypeOf(([make230().m230].find(() => true)) as object, null), Object.getPrototypeOf(([make230().m230].find(() => true))) === null)); }

interface R231 { a231: number; m231: () => number }
function make231(): R231 { return { a231: 1, m231: () => 1 }; }
function c231(): void { say("record/find/deleted", (delete ((([make231().m231].find(() => true))) as any).length, Object.hasOwn(([make231().m231].find(() => true)) as object, "length"))); }

interface R232 { a232: number; m232: () => number }
function make232(): R232 { return { a232: 1, m232: () => 1 }; }
function same232(a: unknown, b: unknown): boolean { return a === b; }
function c232(): void { say("record/find/in-a-callee", same232(([make232().m232].find(() => true)), ([make232().m232].find(() => true)))); }

interface R233 { a233: number; m233: () => number }
function make233(): R233 { return { a233: 1, m233: () => 1 }; }
function hit233(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c233(): void { say("record/find/switch", hit233(([make233().m233].find(() => true)), ([make233().m233].find(() => true)))); }

interface R234 { a234: number; m234: () => number }
function make234(): R234 { return { a234: 1, m234: () => 1 }; }
let last234: unknown;
function seen234(f: unknown): boolean { const same = f === last234; last234 = f; return same; }
function c234(): void { say("record/find/kept-then-compared", (seen234(([make234().m234].find(() => true))), seen234(([make234().m234].find(() => true))))); }

interface R235 { a235: number; m235: () => number }
function make235(): R235 { return { a235: 1, m235: () => 1 }; }
function c235(): void { say("record/reduce/strict-eq", ([make235().m235 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) === ([make235().m235 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

interface R236 { a236: number; m236: () => number }
function make236(): R236 { return { a236: 1, m236: () => 1 }; }
function c236(): void { say("record/reduce/strict-ne", ([make236().m236 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) !== ([make236().m236 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

interface R237 { a237: number; m237: () => number }
function make237(): R237 { return { a237: 1, m237: () => 1 }; }
function c237(): void { say("record/reduce/loose-eq", ([make237().m237 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) == ([make237().m237 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

interface R238 { a238: number; m238: () => number }
function make238(): R238 { return { a238: 1, m238: () => 1 }; }
function c238(): void { say("record/reduce/object-is", Object.is(([make238().m238 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)), ([make238().m238 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)))); }

interface R239 { a239: number; m239: () => number }
function make239(): R239 { return { a239: 1, m239: () => 1 }; }
function c239(): void { say("record/reduce/set", new Set([([make239().m239 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)), ([make239().m239 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))]).size); }

interface R240 { a240: number; m240: () => number }
function make240(): R240 { return { a240: 1, m240: () => 1 }; }
function c240(): void { say("record/reduce/map-key", new Map([[([make240().m240 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)), 1], [([make240().m240 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)), 2]]).size); }

c181(); c182(); c183(); c184(); c185(); c186(); c187(); c188(); c189(); c190(); c191(); c192(); c193(); c194(); c195(); c196(); c197(); c198(); c199(); c200(); c201(); c202(); c203(); c204(); c205(); c206(); c207(); c208(); c209(); c210(); c211(); c212(); c213(); c214(); c215(); c216(); c217(); c218(); c219(); c220(); c221(); c222(); c223(); c224(); c225(); c226(); c227(); c228(); c229(); c230(); c231(); c232(); c233(); c234(); c235(); c236(); c237(); c238(); c239(); c240();
console.log(out.join("\n"));
