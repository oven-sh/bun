// Generated program: object and closure identity stays observable when allocations are removed (part 1).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R61 { a61: number; m61: () => number }
function make61(): R61 { return { a61: 1, m61: () => 1 }; }
function pick61(x: R61): unknown { return x.m61; }
function c61(): void { say("record/picked/includes", [(pick61(make61()))].includes((pick61(make61())))); }

interface R62 { a62: number; m62: () => number }
function make62(): R62 { return { a62: 1, m62: () => 1 }; }
function pick62(x: R62): unknown { return x.m62; }
function c62(): void { say("record/picked/index-of", [(pick62(make62()))].indexOf((pick62(make62())))); }

interface R63 { a63: number; m63: () => number }
function make63(): R63 { return { a63: 1, m63: () => 1 }; }
function pick63(x: R63): unknown { return x.m63; }
const ws63 = new WeakSet<object>();
function c63(): void { say("record/picked/weak-set", (ws63.add((pick63(make63())) as object), ws63.has((pick63(make63())) as object))); }

interface R64 { a64: number; m64: () => number }
function make64(): R64 { return { a64: 1, m64: () => 1 }; }
function pick64(x: R64): unknown { return x.m64; }
const wm64 = new WeakMap<object, number>();
function c64(): void { say("record/picked/weak-map", (wm64.set((pick64(make64())) as object, 1), wm64.has((pick64(make64())) as object))); }

interface R65 { a65: number; m65: () => number }
function make65(): R65 { return { a65: 1, m65: () => 1 }; }
function pick65(x: R65): unknown { return x.m65; }
function c65(): void { say("record/picked/written", ((((pick65(make65()))) as any).tag = 1, (((pick65(make65()))) as any).tag)); }

interface R66 { a66: number; m66: () => number }
function make66(): R66 { return { a66: 1, m66: () => 1 }; }
function pick66(x: R66): unknown { return x.m66; }
function c66(): void { say("record/picked/defined", (Object.defineProperty((pick66(make66())) as object, "t", { value: 1 }), "t" in ((pick66(make66())) as object))); }

interface R67 { a67: number; m67: () => number }
function make67(): R67 { return { a67: 1, m67: () => 1 }; }
function pick67(x: R67): unknown { return x.m67; }
function c67(): void { say("record/picked/frozen", (Object.freeze((pick67(make67()))), Object.isFrozen((pick67(make67()))))); }

interface R68 { a68: number; m68: () => number }
function make68(): R68 { return { a68: 1, m68: () => 1 }; }
function pick68(x: R68): unknown { return x.m68; }
function c68(): void { say("record/picked/prototype-set", (Object.setPrototypeOf((pick68(make68())) as object, null), Object.getPrototypeOf((pick68(make68()))) === null)); }

interface R69 { a69: number; m69: () => number }
function make69(): R69 { return { a69: 1, m69: () => 1 }; }
function pick69(x: R69): unknown { return x.m69; }
function c69(): void { say("record/picked/deleted", (delete (((pick69(make69()))) as any).length, Object.hasOwn((pick69(make69())) as object, "length"))); }

interface R70 { a70: number; m70: () => number }
function make70(): R70 { return { a70: 1, m70: () => 1 }; }
function pick70(x: R70): unknown { return x.m70; }
function same70(a: unknown, b: unknown): boolean { return a === b; }
function c70(): void { say("record/picked/in-a-callee", same70((pick70(make70())), (pick70(make70())))); }

interface R71 { a71: number; m71: () => number }
function make71(): R71 { return { a71: 1, m71: () => 1 }; }
function pick71(x: R71): unknown { return x.m71; }
function hit71(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c71(): void { say("record/picked/switch", hit71((pick71(make71())), (pick71(make71())))); }

interface R72 { a72: number; m72: () => number }
function make72(): R72 { return { a72: 1, m72: () => 1 }; }
function pick72(x: R72): unknown { return x.m72; }
let last72: unknown;
function seen72(f: unknown): boolean { const same = f === last72; last72 = f; return same; }
function c72(): void { say("record/picked/kept-then-compared", (seen72((pick72(make72()))), seen72((pick72(make72()))))); }

interface R73 { a73: number; m73: () => number }
function make73(): R73 { return { a73: 1, m73: () => 1 }; }
function pick73(x: R73): unknown { return x.m73; }
function get73(): unknown { return pick73(make73()); }
function c73(): void { say("record/picked-and-returned/strict-eq", (get73()) === (get73())); }

interface R74 { a74: number; m74: () => number }
function make74(): R74 { return { a74: 1, m74: () => 1 }; }
function pick74(x: R74): unknown { return x.m74; }
function get74(): unknown { return pick74(make74()); }
function c74(): void { say("record/picked-and-returned/strict-ne", (get74()) !== (get74())); }

interface R75 { a75: number; m75: () => number }
function make75(): R75 { return { a75: 1, m75: () => 1 }; }
function pick75(x: R75): unknown { return x.m75; }
function get75(): unknown { return pick75(make75()); }
function c75(): void { say("record/picked-and-returned/loose-eq", (get75()) == (get75())); }

interface R76 { a76: number; m76: () => number }
function make76(): R76 { return { a76: 1, m76: () => 1 }; }
function pick76(x: R76): unknown { return x.m76; }
function get76(): unknown { return pick76(make76()); }
function c76(): void { say("record/picked-and-returned/object-is", Object.is((get76()), (get76()))); }

interface R77 { a77: number; m77: () => number }
function make77(): R77 { return { a77: 1, m77: () => 1 }; }
function pick77(x: R77): unknown { return x.m77; }
function get77(): unknown { return pick77(make77()); }
function c77(): void { say("record/picked-and-returned/set", new Set([(get77()), (get77())]).size); }

interface R78 { a78: number; m78: () => number }
function make78(): R78 { return { a78: 1, m78: () => 1 }; }
function pick78(x: R78): unknown { return x.m78; }
function get78(): unknown { return pick78(make78()); }
function c78(): void { say("record/picked-and-returned/map-key", new Map([[(get78()), 1], [(get78()), 2]]).size); }

interface R79 { a79: number; m79: () => number }
function make79(): R79 { return { a79: 1, m79: () => 1 }; }
function pick79(x: R79): unknown { return x.m79; }
function get79(): unknown { return pick79(make79()); }
function c79(): void { say("record/picked-and-returned/includes", [(get79())].includes((get79()))); }

interface R80 { a80: number; m80: () => number }
function make80(): R80 { return { a80: 1, m80: () => 1 }; }
function pick80(x: R80): unknown { return x.m80; }
function get80(): unknown { return pick80(make80()); }
function c80(): void { say("record/picked-and-returned/index-of", [(get80())].indexOf((get80()))); }

interface R81 { a81: number; m81: () => number }
function make81(): R81 { return { a81: 1, m81: () => 1 }; }
function pick81(x: R81): unknown { return x.m81; }
function get81(): unknown { return pick81(make81()); }
const ws81 = new WeakSet<object>();
function c81(): void { say("record/picked-and-returned/weak-set", (ws81.add((get81()) as object), ws81.has((get81()) as object))); }

interface R82 { a82: number; m82: () => number }
function make82(): R82 { return { a82: 1, m82: () => 1 }; }
function pick82(x: R82): unknown { return x.m82; }
function get82(): unknown { return pick82(make82()); }
const wm82 = new WeakMap<object, number>();
function c82(): void { say("record/picked-and-returned/weak-map", (wm82.set((get82()) as object, 1), wm82.has((get82()) as object))); }

interface R83 { a83: number; m83: () => number }
function make83(): R83 { return { a83: 1, m83: () => 1 }; }
function pick83(x: R83): unknown { return x.m83; }
function get83(): unknown { return pick83(make83()); }
function c83(): void { say("record/picked-and-returned/written", ((((get83())) as any).tag = 1, (((get83())) as any).tag)); }

interface R84 { a84: number; m84: () => number }
function make84(): R84 { return { a84: 1, m84: () => 1 }; }
function pick84(x: R84): unknown { return x.m84; }
function get84(): unknown { return pick84(make84()); }
function c84(): void { say("record/picked-and-returned/defined", (Object.defineProperty((get84()) as object, "t", { value: 1 }), "t" in ((get84()) as object))); }

interface R85 { a85: number; m85: () => number }
function make85(): R85 { return { a85: 1, m85: () => 1 }; }
function pick85(x: R85): unknown { return x.m85; }
function get85(): unknown { return pick85(make85()); }
function c85(): void { say("record/picked-and-returned/frozen", (Object.freeze((get85())), Object.isFrozen((get85())))); }

interface R86 { a86: number; m86: () => number }
function make86(): R86 { return { a86: 1, m86: () => 1 }; }
function pick86(x: R86): unknown { return x.m86; }
function get86(): unknown { return pick86(make86()); }
function c86(): void { say("record/picked-and-returned/prototype-set", (Object.setPrototypeOf((get86()) as object, null), Object.getPrototypeOf((get86())) === null)); }

interface R87 { a87: number; m87: () => number }
function make87(): R87 { return { a87: 1, m87: () => 1 }; }
function pick87(x: R87): unknown { return x.m87; }
function get87(): unknown { return pick87(make87()); }
function c87(): void { say("record/picked-and-returned/deleted", (delete (((get87())) as any).length, Object.hasOwn((get87()) as object, "length"))); }

interface R88 { a88: number; m88: () => number }
function make88(): R88 { return { a88: 1, m88: () => 1 }; }
function pick88(x: R88): unknown { return x.m88; }
function get88(): unknown { return pick88(make88()); }
function same88(a: unknown, b: unknown): boolean { return a === b; }
function c88(): void { say("record/picked-and-returned/in-a-callee", same88((get88()), (get88()))); }

interface R89 { a89: number; m89: () => number }
function make89(): R89 { return { a89: 1, m89: () => 1 }; }
function pick89(x: R89): unknown { return x.m89; }
function get89(): unknown { return pick89(make89()); }
function hit89(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c89(): void { say("record/picked-and-returned/switch", hit89((get89()), (get89()))); }

interface R90 { a90: number; m90: () => number }
function make90(): R90 { return { a90: 1, m90: () => 1 }; }
function pick90(x: R90): unknown { return x.m90; }
function get90(): unknown { return pick90(make90()); }
let last90: unknown;
function seen90(f: unknown): boolean { const same = f === last90; last90 = f; return same; }
function c90(): void { say("record/picked-and-returned/kept-then-compared", (seen90((get90())), seen90((get90())))); }

interface R91 { a91: number; m91: () => number }
function make91(): R91 { return { a91: 1, m91: () => 1 }; }
let slot91: unknown;
function put91(): unknown { slot91 = make91().m91; return 0; }
function c91(): void { say("record/variable/strict-eq", ((put91(), slot91)) === ((put91(), slot91))); }

interface R92 { a92: number; m92: () => number }
function make92(): R92 { return { a92: 1, m92: () => 1 }; }
let slot92: unknown;
function put92(): unknown { slot92 = make92().m92; return 0; }
function c92(): void { say("record/variable/strict-ne", ((put92(), slot92)) !== ((put92(), slot92))); }

interface R93 { a93: number; m93: () => number }
function make93(): R93 { return { a93: 1, m93: () => 1 }; }
let slot93: unknown;
function put93(): unknown { slot93 = make93().m93; return 0; }
function c93(): void { say("record/variable/loose-eq", ((put93(), slot93)) == ((put93(), slot93))); }

interface R94 { a94: number; m94: () => number }
function make94(): R94 { return { a94: 1, m94: () => 1 }; }
let slot94: unknown;
function put94(): unknown { slot94 = make94().m94; return 0; }
function c94(): void { say("record/variable/object-is", Object.is(((put94(), slot94)), ((put94(), slot94)))); }

interface R95 { a95: number; m95: () => number }
function make95(): R95 { return { a95: 1, m95: () => 1 }; }
let slot95: unknown;
function put95(): unknown { slot95 = make95().m95; return 0; }
function c95(): void { say("record/variable/set", new Set([((put95(), slot95)), ((put95(), slot95))]).size); }

interface R96 { a96: number; m96: () => number }
function make96(): R96 { return { a96: 1, m96: () => 1 }; }
let slot96: unknown;
function put96(): unknown { slot96 = make96().m96; return 0; }
function c96(): void { say("record/variable/map-key", new Map([[((put96(), slot96)), 1], [((put96(), slot96)), 2]]).size); }

interface R97 { a97: number; m97: () => number }
function make97(): R97 { return { a97: 1, m97: () => 1 }; }
let slot97: unknown;
function put97(): unknown { slot97 = make97().m97; return 0; }
function c97(): void { say("record/variable/includes", [((put97(), slot97))].includes(((put97(), slot97)))); }

interface R98 { a98: number; m98: () => number }
function make98(): R98 { return { a98: 1, m98: () => 1 }; }
let slot98: unknown;
function put98(): unknown { slot98 = make98().m98; return 0; }
function c98(): void { say("record/variable/index-of", [((put98(), slot98))].indexOf(((put98(), slot98)))); }

interface R99 { a99: number; m99: () => number }
function make99(): R99 { return { a99: 1, m99: () => 1 }; }
let slot99: unknown;
function put99(): unknown { slot99 = make99().m99; return 0; }
const ws99 = new WeakSet<object>();
function c99(): void { say("record/variable/weak-set", (ws99.add(((put99(), slot99)) as object), ws99.has(((put99(), slot99)) as object))); }

interface R100 { a100: number; m100: () => number }
function make100(): R100 { return { a100: 1, m100: () => 1 }; }
let slot100: unknown;
function put100(): unknown { slot100 = make100().m100; return 0; }
const wm100 = new WeakMap<object, number>();
function c100(): void { say("record/variable/weak-map", (wm100.set(((put100(), slot100)) as object, 1), wm100.has(((put100(), slot100)) as object))); }

interface R101 { a101: number; m101: () => number }
function make101(): R101 { return { a101: 1, m101: () => 1 }; }
let slot101: unknown;
function put101(): unknown { slot101 = make101().m101; return 0; }
function c101(): void { say("record/variable/written", (((((put101(), slot101))) as any).tag = 1, ((((put101(), slot101))) as any).tag)); }

interface R102 { a102: number; m102: () => number }
function make102(): R102 { return { a102: 1, m102: () => 1 }; }
let slot102: unknown;
function put102(): unknown { slot102 = make102().m102; return 0; }
function c102(): void { say("record/variable/defined", (Object.defineProperty(((put102(), slot102)) as object, "t", { value: 1 }), "t" in (((put102(), slot102)) as object))); }

interface R103 { a103: number; m103: () => number }
function make103(): R103 { return { a103: 1, m103: () => 1 }; }
let slot103: unknown;
function put103(): unknown { slot103 = make103().m103; return 0; }
function c103(): void { say("record/variable/frozen", (Object.freeze(((put103(), slot103))), Object.isFrozen(((put103(), slot103))))); }

interface R104 { a104: number; m104: () => number }
function make104(): R104 { return { a104: 1, m104: () => 1 }; }
let slot104: unknown;
function put104(): unknown { slot104 = make104().m104; return 0; }
function c104(): void { say("record/variable/prototype-set", (Object.setPrototypeOf(((put104(), slot104)) as object, null), Object.getPrototypeOf(((put104(), slot104))) === null)); }

interface R105 { a105: number; m105: () => number }
function make105(): R105 { return { a105: 1, m105: () => 1 }; }
let slot105: unknown;
function put105(): unknown { slot105 = make105().m105; return 0; }
function c105(): void { say("record/variable/deleted", (delete ((((put105(), slot105))) as any).length, Object.hasOwn(((put105(), slot105)) as object, "length"))); }

interface R106 { a106: number; m106: () => number }
function make106(): R106 { return { a106: 1, m106: () => 1 }; }
let slot106: unknown;
function put106(): unknown { slot106 = make106().m106; return 0; }
function same106(a: unknown, b: unknown): boolean { return a === b; }
function c106(): void { say("record/variable/in-a-callee", same106(((put106(), slot106)), ((put106(), slot106)))); }

interface R107 { a107: number; m107: () => number }
function make107(): R107 { return { a107: 1, m107: () => 1 }; }
let slot107: unknown;
function put107(): unknown { slot107 = make107().m107; return 0; }
function hit107(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c107(): void { say("record/variable/switch", hit107(((put107(), slot107)), ((put107(), slot107)))); }

interface R108 { a108: number; m108: () => number }
function make108(): R108 { return { a108: 1, m108: () => 1 }; }
let slot108: unknown;
function put108(): unknown { slot108 = make108().m108; return 0; }
let last108: unknown;
function seen108(f: unknown): boolean { const same = f === last108; last108 = f; return same; }
function c108(): void { say("record/variable/kept-then-compared", (seen108(((put108(), slot108))), seen108(((put108(), slot108))))); }

interface R109 { a109: number; m109: () => number }
function make109(): R109 { return { a109: 1, m109: () => 1 }; }
let kept109: R109 | undefined;
function keep109(): unknown { kept109 = make109(); return 0; }
function c109(): void { say("record/holder-in-a-variable/strict-eq", ((keep109(), kept109!.m109)) === ((keep109(), kept109!.m109))); }

interface R110 { a110: number; m110: () => number }
function make110(): R110 { return { a110: 1, m110: () => 1 }; }
let kept110: R110 | undefined;
function keep110(): unknown { kept110 = make110(); return 0; }
function c110(): void { say("record/holder-in-a-variable/strict-ne", ((keep110(), kept110!.m110)) !== ((keep110(), kept110!.m110))); }

interface R111 { a111: number; m111: () => number }
function make111(): R111 { return { a111: 1, m111: () => 1 }; }
let kept111: R111 | undefined;
function keep111(): unknown { kept111 = make111(); return 0; }
function c111(): void { say("record/holder-in-a-variable/loose-eq", ((keep111(), kept111!.m111)) == ((keep111(), kept111!.m111))); }

interface R112 { a112: number; m112: () => number }
function make112(): R112 { return { a112: 1, m112: () => 1 }; }
let kept112: R112 | undefined;
function keep112(): unknown { kept112 = make112(); return 0; }
function c112(): void { say("record/holder-in-a-variable/object-is", Object.is(((keep112(), kept112!.m112)), ((keep112(), kept112!.m112)))); }

interface R113 { a113: number; m113: () => number }
function make113(): R113 { return { a113: 1, m113: () => 1 }; }
let kept113: R113 | undefined;
function keep113(): unknown { kept113 = make113(); return 0; }
function c113(): void { say("record/holder-in-a-variable/set", new Set([((keep113(), kept113!.m113)), ((keep113(), kept113!.m113))]).size); }

interface R114 { a114: number; m114: () => number }
function make114(): R114 { return { a114: 1, m114: () => 1 }; }
let kept114: R114 | undefined;
function keep114(): unknown { kept114 = make114(); return 0; }
function c114(): void { say("record/holder-in-a-variable/map-key", new Map([[((keep114(), kept114!.m114)), 1], [((keep114(), kept114!.m114)), 2]]).size); }

interface R115 { a115: number; m115: () => number }
function make115(): R115 { return { a115: 1, m115: () => 1 }; }
let kept115: R115 | undefined;
function keep115(): unknown { kept115 = make115(); return 0; }
function c115(): void { say("record/holder-in-a-variable/includes", [((keep115(), kept115!.m115))].includes(((keep115(), kept115!.m115)))); }

interface R116 { a116: number; m116: () => number }
function make116(): R116 { return { a116: 1, m116: () => 1 }; }
let kept116: R116 | undefined;
function keep116(): unknown { kept116 = make116(); return 0; }
function c116(): void { say("record/holder-in-a-variable/index-of", [((keep116(), kept116!.m116))].indexOf(((keep116(), kept116!.m116)))); }

interface R117 { a117: number; m117: () => number }
function make117(): R117 { return { a117: 1, m117: () => 1 }; }
let kept117: R117 | undefined;
function keep117(): unknown { kept117 = make117(); return 0; }
const ws117 = new WeakSet<object>();
function c117(): void { say("record/holder-in-a-variable/weak-set", (ws117.add(((keep117(), kept117!.m117)) as object), ws117.has(((keep117(), kept117!.m117)) as object))); }

interface R118 { a118: number; m118: () => number }
function make118(): R118 { return { a118: 1, m118: () => 1 }; }
let kept118: R118 | undefined;
function keep118(): unknown { kept118 = make118(); return 0; }
const wm118 = new WeakMap<object, number>();
function c118(): void { say("record/holder-in-a-variable/weak-map", (wm118.set(((keep118(), kept118!.m118)) as object, 1), wm118.has(((keep118(), kept118!.m118)) as object))); }

interface R119 { a119: number; m119: () => number }
function make119(): R119 { return { a119: 1, m119: () => 1 }; }
let kept119: R119 | undefined;
function keep119(): unknown { kept119 = make119(); return 0; }
function c119(): void { say("record/holder-in-a-variable/written", (((((keep119(), kept119!.m119))) as any).tag = 1, ((((keep119(), kept119!.m119))) as any).tag)); }

interface R120 { a120: number; m120: () => number }
function make120(): R120 { return { a120: 1, m120: () => 1 }; }
let kept120: R120 | undefined;
function keep120(): unknown { kept120 = make120(); return 0; }
function c120(): void { say("record/holder-in-a-variable/defined", (Object.defineProperty(((keep120(), kept120!.m120)) as object, "t", { value: 1 }), "t" in (((keep120(), kept120!.m120)) as object))); }

c61(); c62(); c63(); c64(); c65(); c66(); c67(); c68(); c69(); c70(); c71(); c72(); c73(); c74(); c75(); c76(); c77(); c78(); c79(); c80(); c81(); c82(); c83(); c84(); c85(); c86(); c87(); c88(); c89(); c90(); c91(); c92(); c93(); c94(); c95(); c96(); c97(); c98(); c99(); c100(); c101(); c102(); c103(); c104(); c105(); c106(); c107(); c108(); c109(); c110(); c111(); c112(); c113(); c114(); c115(); c116(); c117(); c118(); c119(); c120();
console.log(out.join("\n"));
