// Generated program: object and closure identity stays observable when allocations are removed (part 3).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R181 { a181: number; m181: () => number }
function make181(): R181 { return { a181: 1, m181: () => 1 }; }
function wrap181(): { f: unknown } { return { f: make181().m181 }; }
function c181(): void { say("record/rewrapped/strict-eq", (wrap181().f) === (wrap181().f)); }

interface R182 { a182: number; m182: () => number }
function make182(): R182 { return { a182: 1, m182: () => 1 }; }
function wrap182(): { f: unknown } { return { f: make182().m182 }; }
function c182(): void { say("record/rewrapped/strict-ne", (wrap182().f) !== (wrap182().f)); }

interface R183 { a183: number; m183: () => number }
function make183(): R183 { return { a183: 1, m183: () => 1 }; }
function wrap183(): { f: unknown } { return { f: make183().m183 }; }
function c183(): void { say("record/rewrapped/loose-eq", (wrap183().f) == (wrap183().f)); }

interface R184 { a184: number; m184: () => number }
function make184(): R184 { return { a184: 1, m184: () => 1 }; }
function wrap184(): { f: unknown } { return { f: make184().m184 }; }
function c184(): void { say("record/rewrapped/object-is", Object.is((wrap184().f), (wrap184().f))); }

interface R185 { a185: number; m185: () => number }
function make185(): R185 { return { a185: 1, m185: () => 1 }; }
function wrap185(): { f: unknown } { return { f: make185().m185 }; }
function c185(): void { say("record/rewrapped/set", new Set([(wrap185().f), (wrap185().f)]).size); }

interface R186 { a186: number; m186: () => number }
function make186(): R186 { return { a186: 1, m186: () => 1 }; }
function wrap186(): { f: unknown } { return { f: make186().m186 }; }
function c186(): void { say("record/rewrapped/map-key", new Map([[(wrap186().f), 1], [(wrap186().f), 2]]).size); }

interface R187 { a187: number; m187: () => number }
function make187(): R187 { return { a187: 1, m187: () => 1 }; }
function wrap187(): { f: unknown } { return { f: make187().m187 }; }
function c187(): void { say("record/rewrapped/includes", [(wrap187().f)].includes((wrap187().f))); }

interface R188 { a188: number; m188: () => number }
function make188(): R188 { return { a188: 1, m188: () => 1 }; }
function wrap188(): { f: unknown } { return { f: make188().m188 }; }
function c188(): void { say("record/rewrapped/index-of", [(wrap188().f)].indexOf((wrap188().f))); }

interface R189 { a189: number; m189: () => number }
function make189(): R189 { return { a189: 1, m189: () => 1 }; }
function wrap189(): { f: unknown } { return { f: make189().m189 }; }
const ws189 = new WeakSet<object>();
function c189(): void { say("record/rewrapped/weak-set", (ws189.add((wrap189().f) as object), ws189.has((wrap189().f) as object))); }

interface R190 { a190: number; m190: () => number }
function make190(): R190 { return { a190: 1, m190: () => 1 }; }
function wrap190(): { f: unknown } { return { f: make190().m190 }; }
const wm190 = new WeakMap<object, number>();
function c190(): void { say("record/rewrapped/weak-map", (wm190.set((wrap190().f) as object, 1), wm190.has((wrap190().f) as object))); }

interface R191 { a191: number; m191: () => number }
function make191(): R191 { return { a191: 1, m191: () => 1 }; }
function wrap191(): { f: unknown } { return { f: make191().m191 }; }
function c191(): void { say("record/rewrapped/written", ((((wrap191().f)) as any).tag = 1, (((wrap191().f)) as any).tag)); }

interface R192 { a192: number; m192: () => number }
function make192(): R192 { return { a192: 1, m192: () => 1 }; }
function wrap192(): { f: unknown } { return { f: make192().m192 }; }
function c192(): void { say("record/rewrapped/defined", (Object.defineProperty((wrap192().f) as object, "t", { value: 1 }), "t" in ((wrap192().f) as object))); }

interface R193 { a193: number; m193: () => number }
function make193(): R193 { return { a193: 1, m193: () => 1 }; }
function wrap193(): { f: unknown } { return { f: make193().m193 }; }
function c193(): void { say("record/rewrapped/frozen", (Object.freeze((wrap193().f)), Object.isFrozen((wrap193().f)))); }

interface R194 { a194: number; m194: () => number }
function make194(): R194 { return { a194: 1, m194: () => 1 }; }
function wrap194(): { f: unknown } { return { f: make194().m194 }; }
function c194(): void { say("record/rewrapped/prototype-set", (Object.setPrototypeOf((wrap194().f) as object, null), Object.getPrototypeOf((wrap194().f)) === null)); }

interface R195 { a195: number; m195: () => number }
function make195(): R195 { return { a195: 1, m195: () => 1 }; }
function wrap195(): { f: unknown } { return { f: make195().m195 }; }
function c195(): void { say("record/rewrapped/deleted", (delete (((wrap195().f)) as any).length, Object.hasOwn((wrap195().f) as object, "length"))); }

interface R196 { a196: number; m196: () => number }
function make196(): R196 { return { a196: 1, m196: () => 1 }; }
function wrap196(): { f: unknown } { return { f: make196().m196 }; }
function same196(a: unknown, b: unknown): boolean { return a === b; }
function c196(): void { say("record/rewrapped/in-a-callee", same196((wrap196().f), (wrap196().f))); }

interface R197 { a197: number; m197: () => number }
function make197(): R197 { return { a197: 1, m197: () => 1 }; }
function wrap197(): { f: unknown } { return { f: make197().m197 }; }
function hit197(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c197(): void { say("record/rewrapped/switch", hit197((wrap197().f), (wrap197().f))); }

interface R198 { a198: number; m198: () => number }
function make198(): R198 { return { a198: 1, m198: () => 1 }; }
function wrap198(): { f: unknown } { return { f: make198().m198 }; }
let last198: unknown;
function seen198(f: unknown): boolean { const same = f === last198; last198 = f; return same; }
function c198(): void { say("record/rewrapped/kept-then-compared", (seen198((wrap198().f)), seen198((wrap198().f)))); }

interface R199 { a199: number; m199: () => number }
function make199(): R199 { return { a199: 1, m199: () => 1 }; }
function wrap199(): unknown[] { return [make199().m199]; }
function c199(): void { say("record/rewrapped-in-an-array/strict-eq", (wrap199()[0]) === (wrap199()[0])); }

interface R200 { a200: number; m200: () => number }
function make200(): R200 { return { a200: 1, m200: () => 1 }; }
function wrap200(): unknown[] { return [make200().m200]; }
function c200(): void { say("record/rewrapped-in-an-array/strict-ne", (wrap200()[0]) !== (wrap200()[0])); }

interface R201 { a201: number; m201: () => number }
function make201(): R201 { return { a201: 1, m201: () => 1 }; }
function wrap201(): unknown[] { return [make201().m201]; }
function c201(): void { say("record/rewrapped-in-an-array/loose-eq", (wrap201()[0]) == (wrap201()[0])); }

interface R202 { a202: number; m202: () => number }
function make202(): R202 { return { a202: 1, m202: () => 1 }; }
function wrap202(): unknown[] { return [make202().m202]; }
function c202(): void { say("record/rewrapped-in-an-array/object-is", Object.is((wrap202()[0]), (wrap202()[0]))); }

interface R203 { a203: number; m203: () => number }
function make203(): R203 { return { a203: 1, m203: () => 1 }; }
function wrap203(): unknown[] { return [make203().m203]; }
function c203(): void { say("record/rewrapped-in-an-array/set", new Set([(wrap203()[0]), (wrap203()[0])]).size); }

interface R204 { a204: number; m204: () => number }
function make204(): R204 { return { a204: 1, m204: () => 1 }; }
function wrap204(): unknown[] { return [make204().m204]; }
function c204(): void { say("record/rewrapped-in-an-array/map-key", new Map([[(wrap204()[0]), 1], [(wrap204()[0]), 2]]).size); }

interface R205 { a205: number; m205: () => number }
function make205(): R205 { return { a205: 1, m205: () => 1 }; }
function wrap205(): unknown[] { return [make205().m205]; }
function c205(): void { say("record/rewrapped-in-an-array/includes", [(wrap205()[0])].includes((wrap205()[0]))); }

interface R206 { a206: number; m206: () => number }
function make206(): R206 { return { a206: 1, m206: () => 1 }; }
function wrap206(): unknown[] { return [make206().m206]; }
function c206(): void { say("record/rewrapped-in-an-array/index-of", [(wrap206()[0])].indexOf((wrap206()[0]))); }

interface R207 { a207: number; m207: () => number }
function make207(): R207 { return { a207: 1, m207: () => 1 }; }
function wrap207(): unknown[] { return [make207().m207]; }
const ws207 = new WeakSet<object>();
function c207(): void { say("record/rewrapped-in-an-array/weak-set", (ws207.add((wrap207()[0]) as object), ws207.has((wrap207()[0]) as object))); }

interface R208 { a208: number; m208: () => number }
function make208(): R208 { return { a208: 1, m208: () => 1 }; }
function wrap208(): unknown[] { return [make208().m208]; }
const wm208 = new WeakMap<object, number>();
function c208(): void { say("record/rewrapped-in-an-array/weak-map", (wm208.set((wrap208()[0]) as object, 1), wm208.has((wrap208()[0]) as object))); }

interface R209 { a209: number; m209: () => number }
function make209(): R209 { return { a209: 1, m209: () => 1 }; }
function wrap209(): unknown[] { return [make209().m209]; }
function c209(): void { say("record/rewrapped-in-an-array/written", ((((wrap209()[0])) as any).tag = 1, (((wrap209()[0])) as any).tag)); }

interface R210 { a210: number; m210: () => number }
function make210(): R210 { return { a210: 1, m210: () => 1 }; }
function wrap210(): unknown[] { return [make210().m210]; }
function c210(): void { say("record/rewrapped-in-an-array/defined", (Object.defineProperty((wrap210()[0]) as object, "t", { value: 1 }), "t" in ((wrap210()[0]) as object))); }

interface R211 { a211: number; m211: () => number }
function make211(): R211 { return { a211: 1, m211: () => 1 }; }
function wrap211(): unknown[] { return [make211().m211]; }
function c211(): void { say("record/rewrapped-in-an-array/frozen", (Object.freeze((wrap211()[0])), Object.isFrozen((wrap211()[0])))); }

interface R212 { a212: number; m212: () => number }
function make212(): R212 { return { a212: 1, m212: () => 1 }; }
function wrap212(): unknown[] { return [make212().m212]; }
function c212(): void { say("record/rewrapped-in-an-array/prototype-set", (Object.setPrototypeOf((wrap212()[0]) as object, null), Object.getPrototypeOf((wrap212()[0])) === null)); }

interface R213 { a213: number; m213: () => number }
function make213(): R213 { return { a213: 1, m213: () => 1 }; }
function wrap213(): unknown[] { return [make213().m213]; }
function c213(): void { say("record/rewrapped-in-an-array/deleted", (delete (((wrap213()[0])) as any).length, Object.hasOwn((wrap213()[0]) as object, "length"))); }

interface R214 { a214: number; m214: () => number }
function make214(): R214 { return { a214: 1, m214: () => 1 }; }
function wrap214(): unknown[] { return [make214().m214]; }
function same214(a: unknown, b: unknown): boolean { return a === b; }
function c214(): void { say("record/rewrapped-in-an-array/in-a-callee", same214((wrap214()[0]), (wrap214()[0]))); }

interface R215 { a215: number; m215: () => number }
function make215(): R215 { return { a215: 1, m215: () => 1 }; }
function wrap215(): unknown[] { return [make215().m215]; }
function hit215(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c215(): void { say("record/rewrapped-in-an-array/switch", hit215((wrap215()[0]), (wrap215()[0]))); }

interface R216 { a216: number; m216: () => number }
function make216(): R216 { return { a216: 1, m216: () => 1 }; }
function wrap216(): unknown[] { return [make216().m216]; }
let last216: unknown;
function seen216(f: unknown): boolean { const same = f === last216; last216 = f; return same; }
function c216(): void { say("record/rewrapped-in-an-array/kept-then-compared", (seen216((wrap216()[0])), seen216((wrap216()[0])))); }

interface R217 { a217: number; m217: () => number }
function make217(): R217 { return { a217: 1, m217: () => 1 }; }
function* gen217(): Generator<unknown> { yield make217().m217; }
function c217(): void { say("record/generator/strict-eq", (gen217().next().value) === (gen217().next().value)); }

interface R218 { a218: number; m218: () => number }
function make218(): R218 { return { a218: 1, m218: () => 1 }; }
function* gen218(): Generator<unknown> { yield make218().m218; }
function c218(): void { say("record/generator/strict-ne", (gen218().next().value) !== (gen218().next().value)); }

interface R219 { a219: number; m219: () => number }
function make219(): R219 { return { a219: 1, m219: () => 1 }; }
function* gen219(): Generator<unknown> { yield make219().m219; }
function c219(): void { say("record/generator/loose-eq", (gen219().next().value) == (gen219().next().value)); }

interface R220 { a220: number; m220: () => number }
function make220(): R220 { return { a220: 1, m220: () => 1 }; }
function* gen220(): Generator<unknown> { yield make220().m220; }
function c220(): void { say("record/generator/object-is", Object.is((gen220().next().value), (gen220().next().value))); }

interface R221 { a221: number; m221: () => number }
function make221(): R221 { return { a221: 1, m221: () => 1 }; }
function* gen221(): Generator<unknown> { yield make221().m221; }
function c221(): void { say("record/generator/set", new Set([(gen221().next().value), (gen221().next().value)]).size); }

interface R222 { a222: number; m222: () => number }
function make222(): R222 { return { a222: 1, m222: () => 1 }; }
function* gen222(): Generator<unknown> { yield make222().m222; }
function c222(): void { say("record/generator/map-key", new Map([[(gen222().next().value), 1], [(gen222().next().value), 2]]).size); }

interface R223 { a223: number; m223: () => number }
function make223(): R223 { return { a223: 1, m223: () => 1 }; }
function* gen223(): Generator<unknown> { yield make223().m223; }
function c223(): void { say("record/generator/includes", [(gen223().next().value)].includes((gen223().next().value))); }

interface R224 { a224: number; m224: () => number }
function make224(): R224 { return { a224: 1, m224: () => 1 }; }
function* gen224(): Generator<unknown> { yield make224().m224; }
function c224(): void { say("record/generator/index-of", [(gen224().next().value)].indexOf((gen224().next().value))); }

interface R225 { a225: number; m225: () => number }
function make225(): R225 { return { a225: 1, m225: () => 1 }; }
function* gen225(): Generator<unknown> { yield make225().m225; }
const ws225 = new WeakSet<object>();
function c225(): void { say("record/generator/weak-set", (ws225.add((gen225().next().value) as object), ws225.has((gen225().next().value) as object))); }

interface R226 { a226: number; m226: () => number }
function make226(): R226 { return { a226: 1, m226: () => 1 }; }
function* gen226(): Generator<unknown> { yield make226().m226; }
const wm226 = new WeakMap<object, number>();
function c226(): void { say("record/generator/weak-map", (wm226.set((gen226().next().value) as object, 1), wm226.has((gen226().next().value) as object))); }

interface R227 { a227: number; m227: () => number }
function make227(): R227 { return { a227: 1, m227: () => 1 }; }
function* gen227(): Generator<unknown> { yield make227().m227; }
function c227(): void { say("record/generator/written", ((((gen227().next().value)) as any).tag = 1, (((gen227().next().value)) as any).tag)); }

interface R228 { a228: number; m228: () => number }
function make228(): R228 { return { a228: 1, m228: () => 1 }; }
function* gen228(): Generator<unknown> { yield make228().m228; }
function c228(): void { say("record/generator/defined", (Object.defineProperty((gen228().next().value) as object, "t", { value: 1 }), "t" in ((gen228().next().value) as object))); }

interface R229 { a229: number; m229: () => number }
function make229(): R229 { return { a229: 1, m229: () => 1 }; }
function* gen229(): Generator<unknown> { yield make229().m229; }
function c229(): void { say("record/generator/frozen", (Object.freeze((gen229().next().value)), Object.isFrozen((gen229().next().value)))); }

interface R230 { a230: number; m230: () => number }
function make230(): R230 { return { a230: 1, m230: () => 1 }; }
function* gen230(): Generator<unknown> { yield make230().m230; }
function c230(): void { say("record/generator/prototype-set", (Object.setPrototypeOf((gen230().next().value) as object, null), Object.getPrototypeOf((gen230().next().value)) === null)); }

interface R231 { a231: number; m231: () => number }
function make231(): R231 { return { a231: 1, m231: () => 1 }; }
function* gen231(): Generator<unknown> { yield make231().m231; }
function c231(): void { say("record/generator/deleted", (delete (((gen231().next().value)) as any).length, Object.hasOwn((gen231().next().value) as object, "length"))); }

interface R232 { a232: number; m232: () => number }
function make232(): R232 { return { a232: 1, m232: () => 1 }; }
function* gen232(): Generator<unknown> { yield make232().m232; }
function same232(a: unknown, b: unknown): boolean { return a === b; }
function c232(): void { say("record/generator/in-a-callee", same232((gen232().next().value), (gen232().next().value))); }

interface R233 { a233: number; m233: () => number }
function make233(): R233 { return { a233: 1, m233: () => 1 }; }
function* gen233(): Generator<unknown> { yield make233().m233; }
function hit233(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c233(): void { say("record/generator/switch", hit233((gen233().next().value), (gen233().next().value))); }

interface R234 { a234: number; m234: () => number }
function make234(): R234 { return { a234: 1, m234: () => 1 }; }
function* gen234(): Generator<unknown> { yield make234().m234; }
let last234: unknown;
function seen234(f: unknown): boolean { const same = f === last234; last234 = f; return same; }
function c234(): void { say("record/generator/kept-then-compared", (seen234((gen234().next().value)), seen234((gen234().next().value)))); }

interface R235 { a235: number; m235: () => number }
function make235(): R235 { return { a235: 1, m235: () => 1 }; }
class K235 { get(): unknown { return make235().m235; } }
function c235(): void { say("record/method/strict-eq", (new K235().get()) === (new K235().get())); }

interface R236 { a236: number; m236: () => number }
function make236(): R236 { return { a236: 1, m236: () => 1 }; }
class K236 { get(): unknown { return make236().m236; } }
function c236(): void { say("record/method/strict-ne", (new K236().get()) !== (new K236().get())); }

interface R237 { a237: number; m237: () => number }
function make237(): R237 { return { a237: 1, m237: () => 1 }; }
class K237 { get(): unknown { return make237().m237; } }
function c237(): void { say("record/method/loose-eq", (new K237().get()) == (new K237().get())); }

interface R238 { a238: number; m238: () => number }
function make238(): R238 { return { a238: 1, m238: () => 1 }; }
class K238 { get(): unknown { return make238().m238; } }
function c238(): void { say("record/method/object-is", Object.is((new K238().get()), (new K238().get()))); }

interface R239 { a239: number; m239: () => number }
function make239(): R239 { return { a239: 1, m239: () => 1 }; }
class K239 { get(): unknown { return make239().m239; } }
function c239(): void { say("record/method/set", new Set([(new K239().get()), (new K239().get())]).size); }

interface R240 { a240: number; m240: () => number }
function make240(): R240 { return { a240: 1, m240: () => 1 }; }
class K240 { get(): unknown { return make240().m240; } }
function c240(): void { say("record/method/map-key", new Map([[(new K240().get()), 1], [(new K240().get()), 2]]).size); }

c181(); c182(); c183(); c184(); c185(); c186(); c187(); c188(); c189(); c190(); c191(); c192(); c193(); c194(); c195(); c196(); c197(); c198(); c199(); c200(); c201(); c202(); c203(); c204(); c205(); c206(); c207(); c208(); c209(); c210(); c211(); c212(); c213(); c214(); c215(); c216(); c217(); c218(); c219(); c220(); c221(); c222(); c223(); c224(); c225(); c226(); c227(); c228(); c229(); c230(); c231(); c232(); c233(); c234(); c235(); c236(); c237(); c238(); c239(); c240();
console.log(out.join("\n"));
