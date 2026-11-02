// RUN: lower
// OPTIONS: builtin-modules

// Generated program: object and closure identity stays observable when allocations are removed (part 2).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R121 { a121: number; m121: () => number }
function make121(): R121 { return { a121: 1, m121: () => 1 }; }
let kept121: R121 | undefined;
function keep121(): unknown { kept121 = make121(); return 0; }
function c121(): void { say("record/holder-in-a-variable/frozen", (Object.freeze(((keep121(), kept121!.m121))), Object.isFrozen(((keep121(), kept121!.m121))))); }

interface R122 { a122: number; m122: () => number }
function make122(): R122 { return { a122: 1, m122: () => 1 }; }
let kept122: R122 | undefined;
function keep122(): unknown { kept122 = make122(); return 0; }
function c122(): void { say("record/holder-in-a-variable/prototype-set", (Object.setPrototypeOf(((keep122(), kept122!.m122)) as object, null), Object.getPrototypeOf(((keep122(), kept122!.m122))) === null)); }

interface R123 { a123: number; m123: () => number }
function make123(): R123 { return { a123: 1, m123: () => 1 }; }
let kept123: R123 | undefined;
function keep123(): unknown { kept123 = make123(); return 0; }
function c123(): void { say("record/holder-in-a-variable/deleted", (delete ((((keep123(), kept123!.m123))) as any).length, Object.hasOwn(((keep123(), kept123!.m123)) as object, "length"))); }

interface R124 { a124: number; m124: () => number }
function make124(): R124 { return { a124: 1, m124: () => 1 }; }
let kept124: R124 | undefined;
function keep124(): unknown { kept124 = make124(); return 0; }
function same124(a: unknown, b: unknown): boolean { return a === b; }
function c124(): void { say("record/holder-in-a-variable/in-a-callee", same124(((keep124(), kept124!.m124)), ((keep124(), kept124!.m124)))); }

interface R125 { a125: number; m125: () => number }
function make125(): R125 { return { a125: 1, m125: () => 1 }; }
let kept125: R125 | undefined;
function keep125(): unknown { kept125 = make125(); return 0; }
function hit125(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c125(): void { say("record/holder-in-a-variable/switch", hit125(((keep125(), kept125!.m125)), ((keep125(), kept125!.m125)))); }

interface R126 { a126: number; m126: () => number }
function make126(): R126 { return { a126: 1, m126: () => 1 }; }
let kept126: R126 | undefined;
function keep126(): unknown { kept126 = make126(); return 0; }
let last126: unknown;
function seen126(f: unknown): boolean { const same = f === last126; last126 = f; return same; }
function c126(): void { say("record/holder-in-a-variable/kept-then-compared", (seen126(((keep126(), kept126!.m126))), seen126(((keep126(), kept126!.m126))))); }

interface R127 { a127: number; m127: () => number }
function make127(): R127 { return { a127: 1, m127: () => 1 }; }
function with127<T>(k: (f: unknown) => T): T { return k(make127().m127); }
function c127(): void { say("record/callback/strict-eq", (with127(x => x)) === (with127(x => x))); }

interface R128 { a128: number; m128: () => number }
function make128(): R128 { return { a128: 1, m128: () => 1 }; }
function with128<T>(k: (f: unknown) => T): T { return k(make128().m128); }
function c128(): void { say("record/callback/strict-ne", (with128(x => x)) !== (with128(x => x))); }

interface R129 { a129: number; m129: () => number }
function make129(): R129 { return { a129: 1, m129: () => 1 }; }
function with129<T>(k: (f: unknown) => T): T { return k(make129().m129); }
function c129(): void { say("record/callback/loose-eq", (with129(x => x)) == (with129(x => x))); }

interface R130 { a130: number; m130: () => number }
function make130(): R130 { return { a130: 1, m130: () => 1 }; }
function with130<T>(k: (f: unknown) => T): T { return k(make130().m130); }
function c130(): void { say("record/callback/object-is", Object.is((with130(x => x)), (with130(x => x)))); }

interface R131 { a131: number; m131: () => number }
function make131(): R131 { return { a131: 1, m131: () => 1 }; }
function with131<T>(k: (f: unknown) => T): T { return k(make131().m131); }
function c131(): void { say("record/callback/set", new Set([(with131(x => x)), (with131(x => x))]).size); }

interface R132 { a132: number; m132: () => number }
function make132(): R132 { return { a132: 1, m132: () => 1 }; }
function with132<T>(k: (f: unknown) => T): T { return k(make132().m132); }
function c132(): void { say("record/callback/map-key", new Map([[(with132(x => x)), 1], [(with132(x => x)), 2]]).size); }

interface R133 { a133: number; m133: () => number }
function make133(): R133 { return { a133: 1, m133: () => 1 }; }
function with133<T>(k: (f: unknown) => T): T { return k(make133().m133); }
function c133(): void { say("record/callback/includes", [(with133(x => x))].includes((with133(x => x)))); }

interface R134 { a134: number; m134: () => number }
function make134(): R134 { return { a134: 1, m134: () => 1 }; }
function with134<T>(k: (f: unknown) => T): T { return k(make134().m134); }
function c134(): void { say("record/callback/index-of", [(with134(x => x))].indexOf((with134(x => x)))); }

interface R135 { a135: number; m135: () => number }
function make135(): R135 { return { a135: 1, m135: () => 1 }; }
function with135<T>(k: (f: unknown) => T): T { return k(make135().m135); }
const ws135 = new WeakSet<object>();
function c135(): void { say("record/callback/weak-set", (ws135.add((with135(x => x)) as object), ws135.has((with135(x => x)) as object))); }

interface R136 { a136: number; m136: () => number }
function make136(): R136 { return { a136: 1, m136: () => 1 }; }
function with136<T>(k: (f: unknown) => T): T { return k(make136().m136); }
const wm136 = new WeakMap<object, number>();
function c136(): void { say("record/callback/weak-map", (wm136.set((with136(x => x)) as object, 1), wm136.has((with136(x => x)) as object))); }

interface R137 { a137: number; m137: () => number }
function make137(): R137 { return { a137: 1, m137: () => 1 }; }
function with137<T>(k: (f: unknown) => T): T { return k(make137().m137); }
function c137(): void { say("record/callback/written", ((((with137(x => x))) as any).tag = 1, (((with137(x => x))) as any).tag)); }

interface R138 { a138: number; m138: () => number }
function make138(): R138 { return { a138: 1, m138: () => 1 }; }
function with138<T>(k: (f: unknown) => T): T { return k(make138().m138); }
function c138(): void { say("record/callback/defined", (Object.defineProperty((with138(x => x)) as object, "t", { value: 1 }), "t" in ((with138(x => x)) as object))); }

interface R139 { a139: number; m139: () => number }
function make139(): R139 { return { a139: 1, m139: () => 1 }; }
function with139<T>(k: (f: unknown) => T): T { return k(make139().m139); }
function c139(): void { say("record/callback/frozen", (Object.freeze((with139(x => x))), Object.isFrozen((with139(x => x))))); }

interface R140 { a140: number; m140: () => number }
function make140(): R140 { return { a140: 1, m140: () => 1 }; }
function with140<T>(k: (f: unknown) => T): T { return k(make140().m140); }
function c140(): void { say("record/callback/prototype-set", (Object.setPrototypeOf((with140(x => x)) as object, null), Object.getPrototypeOf((with140(x => x))) === null)); }

interface R141 { a141: number; m141: () => number }
function make141(): R141 { return { a141: 1, m141: () => 1 }; }
function with141<T>(k: (f: unknown) => T): T { return k(make141().m141); }
function c141(): void { say("record/callback/deleted", (delete (((with141(x => x))) as any).length, Object.hasOwn((with141(x => x)) as object, "length"))); }

interface R142 { a142: number; m142: () => number }
function make142(): R142 { return { a142: 1, m142: () => 1 }; }
function with142<T>(k: (f: unknown) => T): T { return k(make142().m142); }
function same142(a: unknown, b: unknown): boolean { return a === b; }
function c142(): void { say("record/callback/in-a-callee", same142((with142(x => x)), (with142(x => x)))); }

interface R143 { a143: number; m143: () => number }
function make143(): R143 { return { a143: 1, m143: () => 1 }; }
function with143<T>(k: (f: unknown) => T): T { return k(make143().m143); }
function hit143(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c143(): void { say("record/callback/switch", hit143((with143(x => x)), (with143(x => x)))); }

interface R144 { a144: number; m144: () => number }
function make144(): R144 { return { a144: 1, m144: () => 1 }; }
function with144<T>(k: (f: unknown) => T): T { return k(make144().m144); }
let last144: unknown;
function seen144(f: unknown): boolean { const same = f === last144; last144 = f; return same; }
function c144(): void { say("record/callback/kept-then-compared", (seen144((with144(x => x))), seen144((with144(x => x))))); }

interface R145 { a145: number; m145: () => number }
function make145(): R145 { return { a145: 1, m145: () => 1 }; }
function later145(): () => unknown { const t = make145(); return () => t.m145; }
function c145(): void { say("record/closure/strict-eq", (later145()()) === (later145()())); }

interface R146 { a146: number; m146: () => number }
function make146(): R146 { return { a146: 1, m146: () => 1 }; }
function later146(): () => unknown { const t = make146(); return () => t.m146; }
function c146(): void { say("record/closure/strict-ne", (later146()()) !== (later146()())); }

interface R147 { a147: number; m147: () => number }
function make147(): R147 { return { a147: 1, m147: () => 1 }; }
function later147(): () => unknown { const t = make147(); return () => t.m147; }
function c147(): void { say("record/closure/loose-eq", (later147()()) == (later147()())); }

interface R148 { a148: number; m148: () => number }
function make148(): R148 { return { a148: 1, m148: () => 1 }; }
function later148(): () => unknown { const t = make148(); return () => t.m148; }
function c148(): void { say("record/closure/object-is", Object.is((later148()()), (later148()()))); }

interface R149 { a149: number; m149: () => number }
function make149(): R149 { return { a149: 1, m149: () => 1 }; }
function later149(): () => unknown { const t = make149(); return () => t.m149; }
function c149(): void { say("record/closure/set", new Set([(later149()()), (later149()())]).size); }

interface R150 { a150: number; m150: () => number }
function make150(): R150 { return { a150: 1, m150: () => 1 }; }
function later150(): () => unknown { const t = make150(); return () => t.m150; }
function c150(): void { say("record/closure/map-key", new Map([[(later150()()), 1], [(later150()()), 2]]).size); }

interface R151 { a151: number; m151: () => number }
function make151(): R151 { return { a151: 1, m151: () => 1 }; }
function later151(): () => unknown { const t = make151(); return () => t.m151; }
function c151(): void { say("record/closure/includes", [(later151()())].includes((later151()()))); }

interface R152 { a152: number; m152: () => number }
function make152(): R152 { return { a152: 1, m152: () => 1 }; }
function later152(): () => unknown { const t = make152(); return () => t.m152; }
function c152(): void { say("record/closure/index-of", [(later152()())].indexOf((later152()()))); }

interface R153 { a153: number; m153: () => number }
function make153(): R153 { return { a153: 1, m153: () => 1 }; }
function later153(): () => unknown { const t = make153(); return () => t.m153; }
const ws153 = new WeakSet<object>();
function c153(): void { say("record/closure/weak-set", (ws153.add((later153()()) as object), ws153.has((later153()()) as object))); }

interface R154 { a154: number; m154: () => number }
function make154(): R154 { return { a154: 1, m154: () => 1 }; }
function later154(): () => unknown { const t = make154(); return () => t.m154; }
const wm154 = new WeakMap<object, number>();
function c154(): void { say("record/closure/weak-map", (wm154.set((later154()()) as object, 1), wm154.has((later154()()) as object))); }

interface R155 { a155: number; m155: () => number }
function make155(): R155 { return { a155: 1, m155: () => 1 }; }
function later155(): () => unknown { const t = make155(); return () => t.m155; }
function c155(): void { say("record/closure/written", ((((later155()())) as any).tag = 1, (((later155()())) as any).tag)); }

interface R156 { a156: number; m156: () => number }
function make156(): R156 { return { a156: 1, m156: () => 1 }; }
function later156(): () => unknown { const t = make156(); return () => t.m156; }
function c156(): void { say("record/closure/defined", (Object.defineProperty((later156()()) as object, "t", { value: 1 }), "t" in ((later156()()) as object))); }

interface R157 { a157: number; m157: () => number }
function make157(): R157 { return { a157: 1, m157: () => 1 }; }
function later157(): () => unknown { const t = make157(); return () => t.m157; }
function c157(): void { say("record/closure/frozen", (Object.freeze((later157()())), Object.isFrozen((later157()())))); }

interface R158 { a158: number; m158: () => number }
function make158(): R158 { return { a158: 1, m158: () => 1 }; }
function later158(): () => unknown { const t = make158(); return () => t.m158; }
function c158(): void { say("record/closure/prototype-set", (Object.setPrototypeOf((later158()()) as object, null), Object.getPrototypeOf((later158()())) === null)); }

interface R159 { a159: number; m159: () => number }
function make159(): R159 { return { a159: 1, m159: () => 1 }; }
function later159(): () => unknown { const t = make159(); return () => t.m159; }
function c159(): void { say("record/closure/deleted", (delete (((later159()())) as any).length, Object.hasOwn((later159()()) as object, "length"))); }

interface R160 { a160: number; m160: () => number }
function make160(): R160 { return { a160: 1, m160: () => 1 }; }
function later160(): () => unknown { const t = make160(); return () => t.m160; }
function same160(a: unknown, b: unknown): boolean { return a === b; }
function c160(): void { say("record/closure/in-a-callee", same160((later160()()), (later160()()))); }

interface R161 { a161: number; m161: () => number }
function make161(): R161 { return { a161: 1, m161: () => 1 }; }
function later161(): () => unknown { const t = make161(); return () => t.m161; }
function hit161(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c161(): void { say("record/closure/switch", hit161((later161()()), (later161()()))); }

interface R162 { a162: number; m162: () => number }
function make162(): R162 { return { a162: 1, m162: () => 1 }; }
function later162(): () => unknown { const t = make162(); return () => t.m162; }
let last162: unknown;
function seen162(f: unknown): boolean { const same = f === last162; last162 = f; return same; }
function c162(): void { say("record/closure/kept-then-compared", (seen162((later162()())), seen162((later162()())))); }

interface R163 { a163: number; m163: () => number }
function make163(): R163 { return { a163: 1, m163: () => 1 }; }
function later163(): () => unknown { const f = make163().m163; return () => f; }
function c163(): void { say("record/captured/strict-eq", (later163()()) === (later163()())); }

interface R164 { a164: number; m164: () => number }
function make164(): R164 { return { a164: 1, m164: () => 1 }; }
function later164(): () => unknown { const f = make164().m164; return () => f; }
function c164(): void { say("record/captured/strict-ne", (later164()()) !== (later164()())); }

interface R165 { a165: number; m165: () => number }
function make165(): R165 { return { a165: 1, m165: () => 1 }; }
function later165(): () => unknown { const f = make165().m165; return () => f; }
function c165(): void { say("record/captured/loose-eq", (later165()()) == (later165()())); }

interface R166 { a166: number; m166: () => number }
function make166(): R166 { return { a166: 1, m166: () => 1 }; }
function later166(): () => unknown { const f = make166().m166; return () => f; }
function c166(): void { say("record/captured/object-is", Object.is((later166()()), (later166()()))); }

interface R167 { a167: number; m167: () => number }
function make167(): R167 { return { a167: 1, m167: () => 1 }; }
function later167(): () => unknown { const f = make167().m167; return () => f; }
function c167(): void { say("record/captured/set", new Set([(later167()()), (later167()())]).size); }

interface R168 { a168: number; m168: () => number }
function make168(): R168 { return { a168: 1, m168: () => 1 }; }
function later168(): () => unknown { const f = make168().m168; return () => f; }
function c168(): void { say("record/captured/map-key", new Map([[(later168()()), 1], [(later168()()), 2]]).size); }

interface R169 { a169: number; m169: () => number }
function make169(): R169 { return { a169: 1, m169: () => 1 }; }
function later169(): () => unknown { const f = make169().m169; return () => f; }
function c169(): void { say("record/captured/includes", [(later169()())].includes((later169()()))); }

interface R170 { a170: number; m170: () => number }
function make170(): R170 { return { a170: 1, m170: () => 1 }; }
function later170(): () => unknown { const f = make170().m170; return () => f; }
function c170(): void { say("record/captured/index-of", [(later170()())].indexOf((later170()()))); }

interface R171 { a171: number; m171: () => number }
function make171(): R171 { return { a171: 1, m171: () => 1 }; }
function later171(): () => unknown { const f = make171().m171; return () => f; }
const ws171 = new WeakSet<object>();
function c171(): void { say("record/captured/weak-set", (ws171.add((later171()()) as object), ws171.has((later171()()) as object))); }

interface R172 { a172: number; m172: () => number }
function make172(): R172 { return { a172: 1, m172: () => 1 }; }
function later172(): () => unknown { const f = make172().m172; return () => f; }
const wm172 = new WeakMap<object, number>();
function c172(): void { say("record/captured/weak-map", (wm172.set((later172()()) as object, 1), wm172.has((later172()()) as object))); }

interface R173 { a173: number; m173: () => number }
function make173(): R173 { return { a173: 1, m173: () => 1 }; }
function later173(): () => unknown { const f = make173().m173; return () => f; }
function c173(): void { say("record/captured/written", ((((later173()())) as any).tag = 1, (((later173()())) as any).tag)); }

interface R174 { a174: number; m174: () => number }
function make174(): R174 { return { a174: 1, m174: () => 1 }; }
function later174(): () => unknown { const f = make174().m174; return () => f; }
function c174(): void { say("record/captured/defined", (Object.defineProperty((later174()()) as object, "t", { value: 1 }), "t" in ((later174()()) as object))); }

interface R175 { a175: number; m175: () => number }
function make175(): R175 { return { a175: 1, m175: () => 1 }; }
function later175(): () => unknown { const f = make175().m175; return () => f; }
function c175(): void { say("record/captured/frozen", (Object.freeze((later175()())), Object.isFrozen((later175()())))); }

interface R176 { a176: number; m176: () => number }
function make176(): R176 { return { a176: 1, m176: () => 1 }; }
function later176(): () => unknown { const f = make176().m176; return () => f; }
function c176(): void { say("record/captured/prototype-set", (Object.setPrototypeOf((later176()()) as object, null), Object.getPrototypeOf((later176()())) === null)); }

interface R177 { a177: number; m177: () => number }
function make177(): R177 { return { a177: 1, m177: () => 1 }; }
function later177(): () => unknown { const f = make177().m177; return () => f; }
function c177(): void { say("record/captured/deleted", (delete (((later177()())) as any).length, Object.hasOwn((later177()()) as object, "length"))); }

interface R178 { a178: number; m178: () => number }
function make178(): R178 { return { a178: 1, m178: () => 1 }; }
function later178(): () => unknown { const f = make178().m178; return () => f; }
function same178(a: unknown, b: unknown): boolean { return a === b; }
function c178(): void { say("record/captured/in-a-callee", same178((later178()()), (later178()()))); }

interface R179 { a179: number; m179: () => number }
function make179(): R179 { return { a179: 1, m179: () => 1 }; }
function later179(): () => unknown { const f = make179().m179; return () => f; }
function hit179(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c179(): void { say("record/captured/switch", hit179((later179()()), (later179()()))); }

interface R180 { a180: number; m180: () => number }
function make180(): R180 { return { a180: 1, m180: () => 1 }; }
function later180(): () => unknown { const f = make180().m180; return () => f; }
let last180: unknown;
function seen180(f: unknown): boolean { const same = f === last180; last180 = f; return same; }
function c180(): void { say("record/captured/kept-then-compared", (seen180((later180()())), seen180((later180()())))); }

c121(); c122(); c123(); c124(); c125(); c126(); c127(); c128(); c129(); c130(); c131(); c132(); c133(); c134(); c135(); c136(); c137(); c138(); c139(); c140(); c141(); c142(); c143(); c144(); c145(); c146(); c147(); c148(); c149(); c150(); c151(); c152(); c153(); c154(); c155(); c156(); c157(); c158(); c159(); c160(); c161(); c162(); c163(); c164(); c165(); c166(); c167(); c168(); c169(); c170(); c171(); c172(); c173(); c174(); c175(); c176(); c177(); c178(); c179(); c180();
console.log(out.join("\n"));

// GENERATED: hit125 c131 c140 c141
// CHECK-LABEL: function {{*}}name="hit125"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=boolean site=[[w_1]]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_1]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = Boolean
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_1]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c131"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = String string="record/callback/set"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="with131"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = NewClosure function=[[f_5]]
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="with131"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = Builtin builtin=Set
// CHECK-NEXT: v10 = Construct v9 calleeName="Set"
// CHECK-NEXT: v11 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v12 = Call v11, v10, v4
// CHECK-NEXT: v13 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v14 = Call v13, v10, v7
// CHECK-NEXT: v15 = Convert v10 declared={type=undefined|null|Set site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v16 = PropGet v15 key="size"
// CHECK-NEXT: v17 = Call v0, -, v1, v16 calleeName="say"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c140"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = String string="record/callback/prototype-set"
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectSetPrototypeOf
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v5 = NewClosure function=[[f_8]]
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="with140"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|object site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Null
// CHECK-NEXT: v9 = Call v3, v2, v7, v8 calleeName="Object.setPrototypeOf"
// CHECK-NEXT: v10 = Builtin builtin=Object
// CHECK-NEXT: v11 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v13 = NewClosure function=[[f_10]]
// CHECK-NEXT: v14 = Call v12, -, v13 calleeName="with140"
// CHECK-NEXT: v15 = Call v11, v10, v14 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v16 = TypeTest v15 testedType=null
// CHECK-NEXT: v17 = Call v0, -, v1, v16 calleeName="say"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c141"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = String string="record/callback/deleted"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v3 = NewClosure function=[[f_12]]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="with141"
// CHECK-NEXT: v5 = PropDelete v4 key="length"
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v9 = NewClosure function=[[f_13]]
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="with141"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|object site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v12 = String string="length"
// CHECK-NEXT: v13 = Call v7, v6, v11, v12 calleeName="Object.hasOwn"
// CHECK-NEXT: v14 = Convert v13 declared={type=boolean site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Call v0, -, v1, v14 calleeName="say"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
