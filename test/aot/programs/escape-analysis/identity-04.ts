// Generated program: object and closure identity stays observable when allocations are removed (part 4).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R241 { a241: number; m241: () => number }
function make241(): R241 { return { a241: 1, m241: () => 1 }; }
class K241 { get(): unknown { return make241().m241; } }
function c241(): void { say("record/method/includes", [(new K241().get())].includes((new K241().get()))); }

interface R242 { a242: number; m242: () => number }
function make242(): R242 { return { a242: 1, m242: () => 1 }; }
class K242 { get(): unknown { return make242().m242; } }
function c242(): void { say("record/method/index-of", [(new K242().get())].indexOf((new K242().get()))); }

interface R243 { a243: number; m243: () => number }
function make243(): R243 { return { a243: 1, m243: () => 1 }; }
class K243 { get(): unknown { return make243().m243; } }
const ws243 = new WeakSet<object>();
function c243(): void { say("record/method/weak-set", (ws243.add((new K243().get()) as object), ws243.has((new K243().get()) as object))); }

interface R244 { a244: number; m244: () => number }
function make244(): R244 { return { a244: 1, m244: () => 1 }; }
class K244 { get(): unknown { return make244().m244; } }
const wm244 = new WeakMap<object, number>();
function c244(): void { say("record/method/weak-map", (wm244.set((new K244().get()) as object, 1), wm244.has((new K244().get()) as object))); }

interface R245 { a245: number; m245: () => number }
function make245(): R245 { return { a245: 1, m245: () => 1 }; }
class K245 { get(): unknown { return make245().m245; } }
function c245(): void { say("record/method/written", ((((new K245().get())) as any).tag = 1, (((new K245().get())) as any).tag)); }

interface R246 { a246: number; m246: () => number }
function make246(): R246 { return { a246: 1, m246: () => 1 }; }
class K246 { get(): unknown { return make246().m246; } }
function c246(): void { say("record/method/defined", (Object.defineProperty((new K246().get()) as object, "t", { value: 1 }), "t" in ((new K246().get()) as object))); }

interface R247 { a247: number; m247: () => number }
function make247(): R247 { return { a247: 1, m247: () => 1 }; }
class K247 { get(): unknown { return make247().m247; } }
function c247(): void { say("record/method/frozen", (Object.freeze((new K247().get())), Object.isFrozen((new K247().get())))); }

interface R248 { a248: number; m248: () => number }
function make248(): R248 { return { a248: 1, m248: () => 1 }; }
class K248 { get(): unknown { return make248().m248; } }
function c248(): void { say("record/method/prototype-set", (Object.setPrototypeOf((new K248().get()) as object, null), Object.getPrototypeOf((new K248().get())) === null)); }

interface R249 { a249: number; m249: () => number }
function make249(): R249 { return { a249: 1, m249: () => 1 }; }
class K249 { get(): unknown { return make249().m249; } }
function c249(): void { say("record/method/deleted", (delete (((new K249().get())) as any).length, Object.hasOwn((new K249().get()) as object, "length"))); }

interface R250 { a250: number; m250: () => number }
function make250(): R250 { return { a250: 1, m250: () => 1 }; }
class K250 { get(): unknown { return make250().m250; } }
function same250(a: unknown, b: unknown): boolean { return a === b; }
function c250(): void { say("record/method/in-a-callee", same250((new K250().get()), (new K250().get()))); }

interface R251 { a251: number; m251: () => number }
function make251(): R251 { return { a251: 1, m251: () => 1 }; }
class K251 { get(): unknown { return make251().m251; } }
function hit251(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c251(): void { say("record/method/switch", hit251((new K251().get()), (new K251().get()))); }

interface R252 { a252: number; m252: () => number }
function make252(): R252 { return { a252: 1, m252: () => 1 }; }
class K252 { get(): unknown { return make252().m252; } }
let last252: unknown;
function seen252(f: unknown): boolean { const same = f === last252; last252 = f; return same; }
function c252(): void { say("record/method/kept-then-compared", (seen252((new K252().get())), seen252((new K252().get())))); }

interface R253 { a253: number; m253: () => number }
function make253(): R253 { return { a253: 1, m253: () => 1 }; }
class K253 { get f(): unknown { return make253().m253; } }
function c253(): void { say("record/accessor/strict-eq", (new K253().f) === (new K253().f)); }

interface R254 { a254: number; m254: () => number }
function make254(): R254 { return { a254: 1, m254: () => 1 }; }
class K254 { get f(): unknown { return make254().m254; } }
function c254(): void { say("record/accessor/strict-ne", (new K254().f) !== (new K254().f)); }

interface R255 { a255: number; m255: () => number }
function make255(): R255 { return { a255: 1, m255: () => 1 }; }
class K255 { get f(): unknown { return make255().m255; } }
function c255(): void { say("record/accessor/loose-eq", (new K255().f) == (new K255().f)); }

interface R256 { a256: number; m256: () => number }
function make256(): R256 { return { a256: 1, m256: () => 1 }; }
class K256 { get f(): unknown { return make256().m256; } }
function c256(): void { say("record/accessor/object-is", Object.is((new K256().f), (new K256().f))); }

interface R257 { a257: number; m257: () => number }
function make257(): R257 { return { a257: 1, m257: () => 1 }; }
class K257 { get f(): unknown { return make257().m257; } }
function c257(): void { say("record/accessor/set", new Set([(new K257().f), (new K257().f)]).size); }

interface R258 { a258: number; m258: () => number }
function make258(): R258 { return { a258: 1, m258: () => 1 }; }
class K258 { get f(): unknown { return make258().m258; } }
function c258(): void { say("record/accessor/map-key", new Map([[(new K258().f), 1], [(new K258().f), 2]]).size); }

interface R259 { a259: number; m259: () => number }
function make259(): R259 { return { a259: 1, m259: () => 1 }; }
class K259 { get f(): unknown { return make259().m259; } }
function c259(): void { say("record/accessor/includes", [(new K259().f)].includes((new K259().f))); }

interface R260 { a260: number; m260: () => number }
function make260(): R260 { return { a260: 1, m260: () => 1 }; }
class K260 { get f(): unknown { return make260().m260; } }
function c260(): void { say("record/accessor/index-of", [(new K260().f)].indexOf((new K260().f))); }

interface R261 { a261: number; m261: () => number }
function make261(): R261 { return { a261: 1, m261: () => 1 }; }
class K261 { get f(): unknown { return make261().m261; } }
const ws261 = new WeakSet<object>();
function c261(): void { say("record/accessor/weak-set", (ws261.add((new K261().f) as object), ws261.has((new K261().f) as object))); }

interface R262 { a262: number; m262: () => number }
function make262(): R262 { return { a262: 1, m262: () => 1 }; }
class K262 { get f(): unknown { return make262().m262; } }
const wm262 = new WeakMap<object, number>();
function c262(): void { say("record/accessor/weak-map", (wm262.set((new K262().f) as object, 1), wm262.has((new K262().f) as object))); }

interface R263 { a263: number; m263: () => number }
function make263(): R263 { return { a263: 1, m263: () => 1 }; }
class K263 { get f(): unknown { return make263().m263; } }
function c263(): void { say("record/accessor/written", ((((new K263().f)) as any).tag = 1, (((new K263().f)) as any).tag)); }

interface R264 { a264: number; m264: () => number }
function make264(): R264 { return { a264: 1, m264: () => 1 }; }
class K264 { get f(): unknown { return make264().m264; } }
function c264(): void { say("record/accessor/defined", (Object.defineProperty((new K264().f) as object, "t", { value: 1 }), "t" in ((new K264().f) as object))); }

interface R265 { a265: number; m265: () => number }
function make265(): R265 { return { a265: 1, m265: () => 1 }; }
class K265 { get f(): unknown { return make265().m265; } }
function c265(): void { say("record/accessor/frozen", (Object.freeze((new K265().f)), Object.isFrozen((new K265().f)))); }

interface R266 { a266: number; m266: () => number }
function make266(): R266 { return { a266: 1, m266: () => 1 }; }
class K266 { get f(): unknown { return make266().m266; } }
function c266(): void { say("record/accessor/prototype-set", (Object.setPrototypeOf((new K266().f) as object, null), Object.getPrototypeOf((new K266().f)) === null)); }

interface R267 { a267: number; m267: () => number }
function make267(): R267 { return { a267: 1, m267: () => 1 }; }
class K267 { get f(): unknown { return make267().m267; } }
function c267(): void { say("record/accessor/deleted", (delete (((new K267().f)) as any).length, Object.hasOwn((new K267().f) as object, "length"))); }

interface R268 { a268: number; m268: () => number }
function make268(): R268 { return { a268: 1, m268: () => 1 }; }
class K268 { get f(): unknown { return make268().m268; } }
function same268(a: unknown, b: unknown): boolean { return a === b; }
function c268(): void { say("record/accessor/in-a-callee", same268((new K268().f), (new K268().f))); }

interface R269 { a269: number; m269: () => number }
function make269(): R269 { return { a269: 1, m269: () => 1 }; }
class K269 { get f(): unknown { return make269().m269; } }
function hit269(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c269(): void { say("record/accessor/switch", hit269((new K269().f), (new K269().f))); }

interface R270 { a270: number; m270: () => number }
function make270(): R270 { return { a270: 1, m270: () => 1 }; }
class K270 { get f(): unknown { return make270().m270; } }
let last270: unknown;
function seen270(f: unknown): boolean { const same = f === last270; last270 = f; return same; }
function c270(): void { say("record/accessor/kept-then-compared", (seen270((new K270().f)), seen270((new K270().f)))); }

interface R271 { a271: number; m271: () => number }
function make271(): R271 { return { a271: 1, m271: () => 1 }; }
function first271(...xs: unknown[]): unknown { return xs[0]; }
function c271(): void { say("record/rest/strict-eq", (first271(make271().m271)) === (first271(make271().m271))); }

interface R272 { a272: number; m272: () => number }
function make272(): R272 { return { a272: 1, m272: () => 1 }; }
function first272(...xs: unknown[]): unknown { return xs[0]; }
function c272(): void { say("record/rest/strict-ne", (first272(make272().m272)) !== (first272(make272().m272))); }

interface R273 { a273: number; m273: () => number }
function make273(): R273 { return { a273: 1, m273: () => 1 }; }
function first273(...xs: unknown[]): unknown { return xs[0]; }
function c273(): void { say("record/rest/loose-eq", (first273(make273().m273)) == (first273(make273().m273))); }

interface R274 { a274: number; m274: () => number }
function make274(): R274 { return { a274: 1, m274: () => 1 }; }
function first274(...xs: unknown[]): unknown { return xs[0]; }
function c274(): void { say("record/rest/object-is", Object.is((first274(make274().m274)), (first274(make274().m274)))); }

interface R275 { a275: number; m275: () => number }
function make275(): R275 { return { a275: 1, m275: () => 1 }; }
function first275(...xs: unknown[]): unknown { return xs[0]; }
function c275(): void { say("record/rest/set", new Set([(first275(make275().m275)), (first275(make275().m275))]).size); }

interface R276 { a276: number; m276: () => number }
function make276(): R276 { return { a276: 1, m276: () => 1 }; }
function first276(...xs: unknown[]): unknown { return xs[0]; }
function c276(): void { say("record/rest/map-key", new Map([[(first276(make276().m276)), 1], [(first276(make276().m276)), 2]]).size); }

interface R277 { a277: number; m277: () => number }
function make277(): R277 { return { a277: 1, m277: () => 1 }; }
function first277(...xs: unknown[]): unknown { return xs[0]; }
function c277(): void { say("record/rest/includes", [(first277(make277().m277))].includes((first277(make277().m277)))); }

interface R278 { a278: number; m278: () => number }
function make278(): R278 { return { a278: 1, m278: () => 1 }; }
function first278(...xs: unknown[]): unknown { return xs[0]; }
function c278(): void { say("record/rest/index-of", [(first278(make278().m278))].indexOf((first278(make278().m278)))); }

interface R279 { a279: number; m279: () => number }
function make279(): R279 { return { a279: 1, m279: () => 1 }; }
function first279(...xs: unknown[]): unknown { return xs[0]; }
const ws279 = new WeakSet<object>();
function c279(): void { say("record/rest/weak-set", (ws279.add((first279(make279().m279)) as object), ws279.has((first279(make279().m279)) as object))); }

interface R280 { a280: number; m280: () => number }
function make280(): R280 { return { a280: 1, m280: () => 1 }; }
function first280(...xs: unknown[]): unknown { return xs[0]; }
const wm280 = new WeakMap<object, number>();
function c280(): void { say("record/rest/weak-map", (wm280.set((first280(make280().m280)) as object, 1), wm280.has((first280(make280().m280)) as object))); }

interface R281 { a281: number; m281: () => number }
function make281(): R281 { return { a281: 1, m281: () => 1 }; }
function first281(...xs: unknown[]): unknown { return xs[0]; }
function c281(): void { say("record/rest/written", ((((first281(make281().m281))) as any).tag = 1, (((first281(make281().m281))) as any).tag)); }

interface R282 { a282: number; m282: () => number }
function make282(): R282 { return { a282: 1, m282: () => 1 }; }
function first282(...xs: unknown[]): unknown { return xs[0]; }
function c282(): void { say("record/rest/defined", (Object.defineProperty((first282(make282().m282)) as object, "t", { value: 1 }), "t" in ((first282(make282().m282)) as object))); }

interface R283 { a283: number; m283: () => number }
function make283(): R283 { return { a283: 1, m283: () => 1 }; }
function first283(...xs: unknown[]): unknown { return xs[0]; }
function c283(): void { say("record/rest/frozen", (Object.freeze((first283(make283().m283))), Object.isFrozen((first283(make283().m283))))); }

interface R284 { a284: number; m284: () => number }
function make284(): R284 { return { a284: 1, m284: () => 1 }; }
function first284(...xs: unknown[]): unknown { return xs[0]; }
function c284(): void { say("record/rest/prototype-set", (Object.setPrototypeOf((first284(make284().m284)) as object, null), Object.getPrototypeOf((first284(make284().m284))) === null)); }

interface R285 { a285: number; m285: () => number }
function make285(): R285 { return { a285: 1, m285: () => 1 }; }
function first285(...xs: unknown[]): unknown { return xs[0]; }
function c285(): void { say("record/rest/deleted", (delete (((first285(make285().m285))) as any).length, Object.hasOwn((first285(make285().m285)) as object, "length"))); }

interface R286 { a286: number; m286: () => number }
function make286(): R286 { return { a286: 1, m286: () => 1 }; }
function first286(...xs: unknown[]): unknown { return xs[0]; }
function same286(a: unknown, b: unknown): boolean { return a === b; }
function c286(): void { say("record/rest/in-a-callee", same286((first286(make286().m286)), (first286(make286().m286)))); }

interface R287 { a287: number; m287: () => number }
function make287(): R287 { return { a287: 1, m287: () => 1 }; }
function first287(...xs: unknown[]): unknown { return xs[0]; }
function hit287(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c287(): void { say("record/rest/switch", hit287((first287(make287().m287)), (first287(make287().m287)))); }

interface R288 { a288: number; m288: () => number }
function make288(): R288 { return { a288: 1, m288: () => 1 }; }
function first288(...xs: unknown[]): unknown { return xs[0]; }
let last288: unknown;
function seen288(f: unknown): boolean { const same = f === last288; last288 = f; return same; }
function c288(): void { say("record/rest/kept-then-compared", (seen288((first288(make288().m288))), seen288((first288(make288().m288))))); }

interface R289 { a289: number; m289: () => number }
function make289(): R289 { return { a289: 1, m289: () => 1 }; }
function get289(): unknown { try { throw make289().m289; } catch (e) { return e; } }
function c289(): void { say("record/thrown/strict-eq", (get289()) === (get289())); }

interface R290 { a290: number; m290: () => number }
function make290(): R290 { return { a290: 1, m290: () => 1 }; }
function get290(): unknown { try { throw make290().m290; } catch (e) { return e; } }
function c290(): void { say("record/thrown/strict-ne", (get290()) !== (get290())); }

interface R291 { a291: number; m291: () => number }
function make291(): R291 { return { a291: 1, m291: () => 1 }; }
function get291(): unknown { try { throw make291().m291; } catch (e) { return e; } }
function c291(): void { say("record/thrown/loose-eq", (get291()) == (get291())); }

interface R292 { a292: number; m292: () => number }
function make292(): R292 { return { a292: 1, m292: () => 1 }; }
function get292(): unknown { try { throw make292().m292; } catch (e) { return e; } }
function c292(): void { say("record/thrown/object-is", Object.is((get292()), (get292()))); }

interface R293 { a293: number; m293: () => number }
function make293(): R293 { return { a293: 1, m293: () => 1 }; }
function get293(): unknown { try { throw make293().m293; } catch (e) { return e; } }
function c293(): void { say("record/thrown/set", new Set([(get293()), (get293())]).size); }

interface R294 { a294: number; m294: () => number }
function make294(): R294 { return { a294: 1, m294: () => 1 }; }
function get294(): unknown { try { throw make294().m294; } catch (e) { return e; } }
function c294(): void { say("record/thrown/map-key", new Map([[(get294()), 1], [(get294()), 2]]).size); }

interface R295 { a295: number; m295: () => number }
function make295(): R295 { return { a295: 1, m295: () => 1 }; }
function get295(): unknown { try { throw make295().m295; } catch (e) { return e; } }
function c295(): void { say("record/thrown/includes", [(get295())].includes((get295()))); }

interface R296 { a296: number; m296: () => number }
function make296(): R296 { return { a296: 1, m296: () => 1 }; }
function get296(): unknown { try { throw make296().m296; } catch (e) { return e; } }
function c296(): void { say("record/thrown/index-of", [(get296())].indexOf((get296()))); }

interface R297 { a297: number; m297: () => number }
function make297(): R297 { return { a297: 1, m297: () => 1 }; }
function get297(): unknown { try { throw make297().m297; } catch (e) { return e; } }
const ws297 = new WeakSet<object>();
function c297(): void { say("record/thrown/weak-set", (ws297.add((get297()) as object), ws297.has((get297()) as object))); }

interface R298 { a298: number; m298: () => number }
function make298(): R298 { return { a298: 1, m298: () => 1 }; }
function get298(): unknown { try { throw make298().m298; } catch (e) { return e; } }
const wm298 = new WeakMap<object, number>();
function c298(): void { say("record/thrown/weak-map", (wm298.set((get298()) as object, 1), wm298.has((get298()) as object))); }

interface R299 { a299: number; m299: () => number }
function make299(): R299 { return { a299: 1, m299: () => 1 }; }
function get299(): unknown { try { throw make299().m299; } catch (e) { return e; } }
function c299(): void { say("record/thrown/written", ((((get299())) as any).tag = 1, (((get299())) as any).tag)); }

interface R300 { a300: number; m300: () => number }
function make300(): R300 { return { a300: 1, m300: () => 1 }; }
function get300(): unknown { try { throw make300().m300; } catch (e) { return e; } }
function c300(): void { say("record/thrown/defined", (Object.defineProperty((get300()) as object, "t", { value: 1 }), "t" in ((get300()) as object))); }

c241(); c242(); c243(); c244(); c245(); c246(); c247(); c248(); c249(); c250(); c251(); c252(); c253(); c254(); c255(); c256(); c257(); c258(); c259(); c260(); c261(); c262(); c263(); c264(); c265(); c266(); c267(); c268(); c269(); c270(); c271(); c272(); c273(); c274(); c275(); c276(); c277(); c278(); c279(); c280(); c281(); c282(); c283(); c284(); c285(); c286(); c287(); c288(); c289(); c290(); c291(); c292(); c293(); c294(); c295(); c296(); c297(); c298(); c299(); c300();
console.log(out.join("\n"));
