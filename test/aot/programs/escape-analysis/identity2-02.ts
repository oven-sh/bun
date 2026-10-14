// Generated program: object and closure identity stays observable when allocations are removed (second series, part 2).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R121 { a121: number; m121: () => number }
function make121(): R121 { return { a121: 1, m121: () => 1 }; }
function tag121(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c121(): void { say("record/tagged-template/frozen", (Object.freeze((tag121`${make121().m121}`)), Object.isFrozen((tag121`${make121().m121}`)))); }

interface R122 { a122: number; m122: () => number }
function make122(): R122 { return { a122: 1, m122: () => 1 }; }
function tag122(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c122(): void { say("record/tagged-template/prototype-set", (Object.setPrototypeOf((tag122`${make122().m122}`) as object, null), Object.getPrototypeOf((tag122`${make122().m122}`)) === null)); }

interface R123 { a123: number; m123: () => number }
function make123(): R123 { return { a123: 1, m123: () => 1 }; }
function tag123(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c123(): void { say("record/tagged-template/deleted", (delete (((tag123`${make123().m123}`)) as any).length, Object.hasOwn((tag123`${make123().m123}`) as object, "length"))); }

interface R124 { a124: number; m124: () => number }
function make124(): R124 { return { a124: 1, m124: () => 1 }; }
function tag124(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function same124(a: unknown, b: unknown): boolean { return a === b; }
function c124(): void { say("record/tagged-template/in-a-callee", same124((tag124`${make124().m124}`), (tag124`${make124().m124}`))); }

interface R125 { a125: number; m125: () => number }
function make125(): R125 { return { a125: 1, m125: () => 1 }; }
function tag125(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function hit125(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c125(): void { say("record/tagged-template/switch", hit125((tag125`${make125().m125}`), (tag125`${make125().m125}`))); }

interface R126 { a126: number; m126: () => number }
function make126(): R126 { return { a126: 1, m126: () => 1 }; }
function tag126(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
let last126: unknown;
function seen126(f: unknown): boolean { const same = f === last126; last126 = f; return same; }
function c126(): void { say("record/tagged-template/kept-then-compared", (seen126((tag126`${make126().m126}`)), seen126((tag126`${make126().m126}`)))); }

interface R127 { a127: number; m127: () => number }
function make127(): R127 { return { a127: 1, m127: () => 1 }; }
function get127(x: unknown = make127().m127): unknown { return x; }
function c127(): void { say("record/default-parameter/strict-eq", (get127()) === (get127())); }

interface R128 { a128: number; m128: () => number }
function make128(): R128 { return { a128: 1, m128: () => 1 }; }
function get128(x: unknown = make128().m128): unknown { return x; }
function c128(): void { say("record/default-parameter/strict-ne", (get128()) !== (get128())); }

interface R129 { a129: number; m129: () => number }
function make129(): R129 { return { a129: 1, m129: () => 1 }; }
function get129(x: unknown = make129().m129): unknown { return x; }
function c129(): void { say("record/default-parameter/loose-eq", (get129()) == (get129())); }

interface R130 { a130: number; m130: () => number }
function make130(): R130 { return { a130: 1, m130: () => 1 }; }
function get130(x: unknown = make130().m130): unknown { return x; }
function c130(): void { say("record/default-parameter/object-is", Object.is((get130()), (get130()))); }

interface R131 { a131: number; m131: () => number }
function make131(): R131 { return { a131: 1, m131: () => 1 }; }
function get131(x: unknown = make131().m131): unknown { return x; }
function c131(): void { say("record/default-parameter/set", new Set([(get131()), (get131())]).size); }

interface R132 { a132: number; m132: () => number }
function make132(): R132 { return { a132: 1, m132: () => 1 }; }
function get132(x: unknown = make132().m132): unknown { return x; }
function c132(): void { say("record/default-parameter/map-key", new Map([[(get132()), 1], [(get132()), 2]]).size); }

interface R133 { a133: number; m133: () => number }
function make133(): R133 { return { a133: 1, m133: () => 1 }; }
function get133(x: unknown = make133().m133): unknown { return x; }
function c133(): void { say("record/default-parameter/includes", [(get133())].includes((get133()))); }

interface R134 { a134: number; m134: () => number }
function make134(): R134 { return { a134: 1, m134: () => 1 }; }
function get134(x: unknown = make134().m134): unknown { return x; }
function c134(): void { say("record/default-parameter/index-of", [(get134())].indexOf((get134()))); }

interface R135 { a135: number; m135: () => number }
function make135(): R135 { return { a135: 1, m135: () => 1 }; }
function get135(x: unknown = make135().m135): unknown { return x; }
const ws135 = new WeakSet<object>();
function c135(): void { say("record/default-parameter/weak-set", (ws135.add((get135()) as object), ws135.has((get135()) as object))); }

interface R136 { a136: number; m136: () => number }
function make136(): R136 { return { a136: 1, m136: () => 1 }; }
function get136(x: unknown = make136().m136): unknown { return x; }
const wm136 = new WeakMap<object, number>();
function c136(): void { say("record/default-parameter/weak-map", (wm136.set((get136()) as object, 1), wm136.has((get136()) as object))); }

interface R137 { a137: number; m137: () => number }
function make137(): R137 { return { a137: 1, m137: () => 1 }; }
function get137(x: unknown = make137().m137): unknown { return x; }
function c137(): void { say("record/default-parameter/written", ((((get137())) as any).tag = 1, (((get137())) as any).tag)); }

interface R138 { a138: number; m138: () => number }
function make138(): R138 { return { a138: 1, m138: () => 1 }; }
function get138(x: unknown = make138().m138): unknown { return x; }
function c138(): void { say("record/default-parameter/defined", (Object.defineProperty((get138()) as object, "t", { value: 1 }), "t" in ((get138()) as object))); }

interface R139 { a139: number; m139: () => number }
function make139(): R139 { return { a139: 1, m139: () => 1 }; }
function get139(x: unknown = make139().m139): unknown { return x; }
function c139(): void { say("record/default-parameter/frozen", (Object.freeze((get139())), Object.isFrozen((get139())))); }

interface R140 { a140: number; m140: () => number }
function make140(): R140 { return { a140: 1, m140: () => 1 }; }
function get140(x: unknown = make140().m140): unknown { return x; }
function c140(): void { say("record/default-parameter/prototype-set", (Object.setPrototypeOf((get140()) as object, null), Object.getPrototypeOf((get140())) === null)); }

interface R141 { a141: number; m141: () => number }
function make141(): R141 { return { a141: 1, m141: () => 1 }; }
function get141(x: unknown = make141().m141): unknown { return x; }
function c141(): void { say("record/default-parameter/deleted", (delete (((get141())) as any).length, Object.hasOwn((get141()) as object, "length"))); }

interface R142 { a142: number; m142: () => number }
function make142(): R142 { return { a142: 1, m142: () => 1 }; }
function get142(x: unknown = make142().m142): unknown { return x; }
function same142(a: unknown, b: unknown): boolean { return a === b; }
function c142(): void { say("record/default-parameter/in-a-callee", same142((get142()), (get142()))); }

interface R143 { a143: number; m143: () => number }
function make143(): R143 { return { a143: 1, m143: () => 1 }; }
function get143(x: unknown = make143().m143): unknown { return x; }
function hit143(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c143(): void { say("record/default-parameter/switch", hit143((get143()), (get143()))); }

interface R144 { a144: number; m144: () => number }
function make144(): R144 { return { a144: 1, m144: () => 1 }; }
function get144(x: unknown = make144().m144): unknown { return x; }
let last144: unknown;
function seen144(f: unknown): boolean { const same = f === last144; last144 = f; return same; }
function c144(): void { say("record/default-parameter/kept-then-compared", (seen144((get144())), seen144((get144())))); }

interface R145 { a145: number; m145: () => number }
function make145(): R145 { return { a145: 1, m145: () => 1 }; }
function get145({ f = make145().m145 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c145(): void { say("record/pattern-default/strict-eq", (get145()) === (get145())); }

interface R146 { a146: number; m146: () => number }
function make146(): R146 { return { a146: 1, m146: () => 1 }; }
function get146({ f = make146().m146 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c146(): void { say("record/pattern-default/strict-ne", (get146()) !== (get146())); }

interface R147 { a147: number; m147: () => number }
function make147(): R147 { return { a147: 1, m147: () => 1 }; }
function get147({ f = make147().m147 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c147(): void { say("record/pattern-default/loose-eq", (get147()) == (get147())); }

interface R148 { a148: number; m148: () => number }
function make148(): R148 { return { a148: 1, m148: () => 1 }; }
function get148({ f = make148().m148 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c148(): void { say("record/pattern-default/object-is", Object.is((get148()), (get148()))); }

interface R149 { a149: number; m149: () => number }
function make149(): R149 { return { a149: 1, m149: () => 1 }; }
function get149({ f = make149().m149 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c149(): void { say("record/pattern-default/set", new Set([(get149()), (get149())]).size); }

interface R150 { a150: number; m150: () => number }
function make150(): R150 { return { a150: 1, m150: () => 1 }; }
function get150({ f = make150().m150 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c150(): void { say("record/pattern-default/map-key", new Map([[(get150()), 1], [(get150()), 2]]).size); }

interface R151 { a151: number; m151: () => number }
function make151(): R151 { return { a151: 1, m151: () => 1 }; }
function get151({ f = make151().m151 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c151(): void { say("record/pattern-default/includes", [(get151())].includes((get151()))); }

interface R152 { a152: number; m152: () => number }
function make152(): R152 { return { a152: 1, m152: () => 1 }; }
function get152({ f = make152().m152 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c152(): void { say("record/pattern-default/index-of", [(get152())].indexOf((get152()))); }

interface R153 { a153: number; m153: () => number }
function make153(): R153 { return { a153: 1, m153: () => 1 }; }
function get153({ f = make153().m153 as unknown }: { f?: unknown } = {}): unknown { return f; }
const ws153 = new WeakSet<object>();
function c153(): void { say("record/pattern-default/weak-set", (ws153.add((get153()) as object), ws153.has((get153()) as object))); }

interface R154 { a154: number; m154: () => number }
function make154(): R154 { return { a154: 1, m154: () => 1 }; }
function get154({ f = make154().m154 as unknown }: { f?: unknown } = {}): unknown { return f; }
const wm154 = new WeakMap<object, number>();
function c154(): void { say("record/pattern-default/weak-map", (wm154.set((get154()) as object, 1), wm154.has((get154()) as object))); }

interface R155 { a155: number; m155: () => number }
function make155(): R155 { return { a155: 1, m155: () => 1 }; }
function get155({ f = make155().m155 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c155(): void { say("record/pattern-default/written", ((((get155())) as any).tag = 1, (((get155())) as any).tag)); }

interface R156 { a156: number; m156: () => number }
function make156(): R156 { return { a156: 1, m156: () => 1 }; }
function get156({ f = make156().m156 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c156(): void { say("record/pattern-default/defined", (Object.defineProperty((get156()) as object, "t", { value: 1 }), "t" in ((get156()) as object))); }

interface R157 { a157: number; m157: () => number }
function make157(): R157 { return { a157: 1, m157: () => 1 }; }
function get157({ f = make157().m157 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c157(): void { say("record/pattern-default/frozen", (Object.freeze((get157())), Object.isFrozen((get157())))); }

interface R158 { a158: number; m158: () => number }
function make158(): R158 { return { a158: 1, m158: () => 1 }; }
function get158({ f = make158().m158 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c158(): void { say("record/pattern-default/prototype-set", (Object.setPrototypeOf((get158()) as object, null), Object.getPrototypeOf((get158())) === null)); }

interface R159 { a159: number; m159: () => number }
function make159(): R159 { return { a159: 1, m159: () => 1 }; }
function get159({ f = make159().m159 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c159(): void { say("record/pattern-default/deleted", (delete (((get159())) as any).length, Object.hasOwn((get159()) as object, "length"))); }

interface R160 { a160: number; m160: () => number }
function make160(): R160 { return { a160: 1, m160: () => 1 }; }
function get160({ f = make160().m160 as unknown }: { f?: unknown } = {}): unknown { return f; }
function same160(a: unknown, b: unknown): boolean { return a === b; }
function c160(): void { say("record/pattern-default/in-a-callee", same160((get160()), (get160()))); }

interface R161 { a161: number; m161: () => number }
function make161(): R161 { return { a161: 1, m161: () => 1 }; }
function get161({ f = make161().m161 as unknown }: { f?: unknown } = {}): unknown { return f; }
function hit161(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c161(): void { say("record/pattern-default/switch", hit161((get161()), (get161()))); }

interface R162 { a162: number; m162: () => number }
function make162(): R162 { return { a162: 1, m162: () => 1 }; }
function get162({ f = make162().m162 as unknown }: { f?: unknown } = {}): unknown { return f; }
let last162: unknown;
function seen162(f: unknown): boolean { const same = f === last162; last162 = f; return same; }
function c162(): void { say("record/pattern-default/kept-then-compared", (seen162((get162())), seen162((get162())))); }

interface R163 { a163: number; m163: () => number }
function make163(): R163 { return { a163: 1, m163: () => 1 }; }
function get163(): unknown { const [f] = [make163().m163]; return f; }
function c163(): void { say("record/array-pattern/strict-eq", (get163()) === (get163())); }

interface R164 { a164: number; m164: () => number }
function make164(): R164 { return { a164: 1, m164: () => 1 }; }
function get164(): unknown { const [f] = [make164().m164]; return f; }
function c164(): void { say("record/array-pattern/strict-ne", (get164()) !== (get164())); }

interface R165 { a165: number; m165: () => number }
function make165(): R165 { return { a165: 1, m165: () => 1 }; }
function get165(): unknown { const [f] = [make165().m165]; return f; }
function c165(): void { say("record/array-pattern/loose-eq", (get165()) == (get165())); }

interface R166 { a166: number; m166: () => number }
function make166(): R166 { return { a166: 1, m166: () => 1 }; }
function get166(): unknown { const [f] = [make166().m166]; return f; }
function c166(): void { say("record/array-pattern/object-is", Object.is((get166()), (get166()))); }

interface R167 { a167: number; m167: () => number }
function make167(): R167 { return { a167: 1, m167: () => 1 }; }
function get167(): unknown { const [f] = [make167().m167]; return f; }
function c167(): void { say("record/array-pattern/set", new Set([(get167()), (get167())]).size); }

interface R168 { a168: number; m168: () => number }
function make168(): R168 { return { a168: 1, m168: () => 1 }; }
function get168(): unknown { const [f] = [make168().m168]; return f; }
function c168(): void { say("record/array-pattern/map-key", new Map([[(get168()), 1], [(get168()), 2]]).size); }

interface R169 { a169: number; m169: () => number }
function make169(): R169 { return { a169: 1, m169: () => 1 }; }
function get169(): unknown { const [f] = [make169().m169]; return f; }
function c169(): void { say("record/array-pattern/includes", [(get169())].includes((get169()))); }

interface R170 { a170: number; m170: () => number }
function make170(): R170 { return { a170: 1, m170: () => 1 }; }
function get170(): unknown { const [f] = [make170().m170]; return f; }
function c170(): void { say("record/array-pattern/index-of", [(get170())].indexOf((get170()))); }

interface R171 { a171: number; m171: () => number }
function make171(): R171 { return { a171: 1, m171: () => 1 }; }
function get171(): unknown { const [f] = [make171().m171]; return f; }
const ws171 = new WeakSet<object>();
function c171(): void { say("record/array-pattern/weak-set", (ws171.add((get171()) as object), ws171.has((get171()) as object))); }

interface R172 { a172: number; m172: () => number }
function make172(): R172 { return { a172: 1, m172: () => 1 }; }
function get172(): unknown { const [f] = [make172().m172]; return f; }
const wm172 = new WeakMap<object, number>();
function c172(): void { say("record/array-pattern/weak-map", (wm172.set((get172()) as object, 1), wm172.has((get172()) as object))); }

interface R173 { a173: number; m173: () => number }
function make173(): R173 { return { a173: 1, m173: () => 1 }; }
function get173(): unknown { const [f] = [make173().m173]; return f; }
function c173(): void { say("record/array-pattern/written", ((((get173())) as any).tag = 1, (((get173())) as any).tag)); }

interface R174 { a174: number; m174: () => number }
function make174(): R174 { return { a174: 1, m174: () => 1 }; }
function get174(): unknown { const [f] = [make174().m174]; return f; }
function c174(): void { say("record/array-pattern/defined", (Object.defineProperty((get174()) as object, "t", { value: 1 }), "t" in ((get174()) as object))); }

interface R175 { a175: number; m175: () => number }
function make175(): R175 { return { a175: 1, m175: () => 1 }; }
function get175(): unknown { const [f] = [make175().m175]; return f; }
function c175(): void { say("record/array-pattern/frozen", (Object.freeze((get175())), Object.isFrozen((get175())))); }

interface R176 { a176: number; m176: () => number }
function make176(): R176 { return { a176: 1, m176: () => 1 }; }
function get176(): unknown { const [f] = [make176().m176]; return f; }
function c176(): void { say("record/array-pattern/prototype-set", (Object.setPrototypeOf((get176()) as object, null), Object.getPrototypeOf((get176())) === null)); }

interface R177 { a177: number; m177: () => number }
function make177(): R177 { return { a177: 1, m177: () => 1 }; }
function get177(): unknown { const [f] = [make177().m177]; return f; }
function c177(): void { say("record/array-pattern/deleted", (delete (((get177())) as any).length, Object.hasOwn((get177()) as object, "length"))); }

interface R178 { a178: number; m178: () => number }
function make178(): R178 { return { a178: 1, m178: () => 1 }; }
function get178(): unknown { const [f] = [make178().m178]; return f; }
function same178(a: unknown, b: unknown): boolean { return a === b; }
function c178(): void { say("record/array-pattern/in-a-callee", same178((get178()), (get178()))); }

interface R179 { a179: number; m179: () => number }
function make179(): R179 { return { a179: 1, m179: () => 1 }; }
function get179(): unknown { const [f] = [make179().m179]; return f; }
function hit179(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c179(): void { say("record/array-pattern/switch", hit179((get179()), (get179()))); }

interface R180 { a180: number; m180: () => number }
function make180(): R180 { return { a180: 1, m180: () => 1 }; }
function get180(): unknown { const [f] = [make180().m180]; return f; }
let last180: unknown;
function seen180(f: unknown): boolean { const same = f === last180; last180 = f; return same; }
function c180(): void { say("record/array-pattern/kept-then-compared", (seen180((get180())), seen180((get180())))); }

c121(); c122(); c123(); c124(); c125(); c126(); c127(); c128(); c129(); c130(); c131(); c132(); c133(); c134(); c135(); c136(); c137(); c138(); c139(); c140(); c141(); c142(); c143(); c144(); c145(); c146(); c147(); c148(); c149(); c150(); c151(); c152(); c153(); c154(); c155(); c156(); c157(); c158(); c159(); c160(); c161(); c162(); c163(); c164(); c165(); c166(); c167(); c168(); c169(); c170(); c171(); c172(); c173(); c174(); c175(); c176(); c177(); c178(); c179(); c180();
console.log(out.join("\n"));
