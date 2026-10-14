// Generated program: object and closure identity stays observable when allocations are removed (second series, part 1).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R61 { a61: number; m61: () => number }
function make61(): R61 { return { a61: 1, m61: () => 1 }; }
class K61 { s: unknown; set v(x: unknown) { this.s = x; } }
function get61(): unknown { const k = new K61(); k.v = make61().m61; return k.s; }
function c61(): void { say("record/setter/includes", [(get61())].includes((get61()))); }

interface R62 { a62: number; m62: () => number }
function make62(): R62 { return { a62: 1, m62: () => 1 }; }
class K62 { s: unknown; set v(x: unknown) { this.s = x; } }
function get62(): unknown { const k = new K62(); k.v = make62().m62; return k.s; }
function c62(): void { say("record/setter/index-of", [(get62())].indexOf((get62()))); }

interface R63 { a63: number; m63: () => number }
function make63(): R63 { return { a63: 1, m63: () => 1 }; }
class K63 { s: unknown; set v(x: unknown) { this.s = x; } }
function get63(): unknown { const k = new K63(); k.v = make63().m63; return k.s; }
const ws63 = new WeakSet<object>();
function c63(): void { say("record/setter/weak-set", (ws63.add((get63()) as object), ws63.has((get63()) as object))); }

interface R64 { a64: number; m64: () => number }
function make64(): R64 { return { a64: 1, m64: () => 1 }; }
class K64 { s: unknown; set v(x: unknown) { this.s = x; } }
function get64(): unknown { const k = new K64(); k.v = make64().m64; return k.s; }
const wm64 = new WeakMap<object, number>();
function c64(): void { say("record/setter/weak-map", (wm64.set((get64()) as object, 1), wm64.has((get64()) as object))); }

interface R65 { a65: number; m65: () => number }
function make65(): R65 { return { a65: 1, m65: () => 1 }; }
class K65 { s: unknown; set v(x: unknown) { this.s = x; } }
function get65(): unknown { const k = new K65(); k.v = make65().m65; return k.s; }
function c65(): void { say("record/setter/written", ((((get65())) as any).tag = 1, (((get65())) as any).tag)); }

interface R66 { a66: number; m66: () => number }
function make66(): R66 { return { a66: 1, m66: () => 1 }; }
class K66 { s: unknown; set v(x: unknown) { this.s = x; } }
function get66(): unknown { const k = new K66(); k.v = make66().m66; return k.s; }
function c66(): void { say("record/setter/defined", (Object.defineProperty((get66()) as object, "t", { value: 1 }), "t" in ((get66()) as object))); }

interface R67 { a67: number; m67: () => number }
function make67(): R67 { return { a67: 1, m67: () => 1 }; }
class K67 { s: unknown; set v(x: unknown) { this.s = x; } }
function get67(): unknown { const k = new K67(); k.v = make67().m67; return k.s; }
function c67(): void { say("record/setter/frozen", (Object.freeze((get67())), Object.isFrozen((get67())))); }

interface R68 { a68: number; m68: () => number }
function make68(): R68 { return { a68: 1, m68: () => 1 }; }
class K68 { s: unknown; set v(x: unknown) { this.s = x; } }
function get68(): unknown { const k = new K68(); k.v = make68().m68; return k.s; }
function c68(): void { say("record/setter/prototype-set", (Object.setPrototypeOf((get68()) as object, null), Object.getPrototypeOf((get68())) === null)); }

interface R69 { a69: number; m69: () => number }
function make69(): R69 { return { a69: 1, m69: () => 1 }; }
class K69 { s: unknown; set v(x: unknown) { this.s = x; } }
function get69(): unknown { const k = new K69(); k.v = make69().m69; return k.s; }
function c69(): void { say("record/setter/deleted", (delete (((get69())) as any).length, Object.hasOwn((get69()) as object, "length"))); }

interface R70 { a70: number; m70: () => number }
function make70(): R70 { return { a70: 1, m70: () => 1 }; }
class K70 { s: unknown; set v(x: unknown) { this.s = x; } }
function get70(): unknown { const k = new K70(); k.v = make70().m70; return k.s; }
function same70(a: unknown, b: unknown): boolean { return a === b; }
function c70(): void { say("record/setter/in-a-callee", same70((get70()), (get70()))); }

interface R71 { a71: number; m71: () => number }
function make71(): R71 { return { a71: 1, m71: () => 1 }; }
class K71 { s: unknown; set v(x: unknown) { this.s = x; } }
function get71(): unknown { const k = new K71(); k.v = make71().m71; return k.s; }
function hit71(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c71(): void { say("record/setter/switch", hit71((get71()), (get71()))); }

interface R72 { a72: number; m72: () => number }
function make72(): R72 { return { a72: 1, m72: () => 1 }; }
class K72 { s: unknown; set v(x: unknown) { this.s = x; } }
function get72(): unknown { const k = new K72(); k.v = make72().m72; return k.s; }
let last72: unknown;
function seen72(f: unknown): boolean { const same = f === last72; last72 = f; return same; }
function c72(): void { say("record/setter/kept-then-compared", (seen72((get72())), seen72((get72())))); }

interface R73 { a73: number; m73: () => number }
function make73(): R73 { return { a73: 1, m73: () => 1 }; }
class B73 { get(): unknown { return make73().m73; } }
class D73 extends B73 { get(): unknown { return super.get(); } }
function c73(): void { say("record/super-method/strict-eq", (new D73().get()) === (new D73().get())); }

interface R74 { a74: number; m74: () => number }
function make74(): R74 { return { a74: 1, m74: () => 1 }; }
class B74 { get(): unknown { return make74().m74; } }
class D74 extends B74 { get(): unknown { return super.get(); } }
function c74(): void { say("record/super-method/strict-ne", (new D74().get()) !== (new D74().get())); }

interface R75 { a75: number; m75: () => number }
function make75(): R75 { return { a75: 1, m75: () => 1 }; }
class B75 { get(): unknown { return make75().m75; } }
class D75 extends B75 { get(): unknown { return super.get(); } }
function c75(): void { say("record/super-method/loose-eq", (new D75().get()) == (new D75().get())); }

interface R76 { a76: number; m76: () => number }
function make76(): R76 { return { a76: 1, m76: () => 1 }; }
class B76 { get(): unknown { return make76().m76; } }
class D76 extends B76 { get(): unknown { return super.get(); } }
function c76(): void { say("record/super-method/object-is", Object.is((new D76().get()), (new D76().get()))); }

interface R77 { a77: number; m77: () => number }
function make77(): R77 { return { a77: 1, m77: () => 1 }; }
class B77 { get(): unknown { return make77().m77; } }
class D77 extends B77 { get(): unknown { return super.get(); } }
function c77(): void { say("record/super-method/set", new Set([(new D77().get()), (new D77().get())]).size); }

interface R78 { a78: number; m78: () => number }
function make78(): R78 { return { a78: 1, m78: () => 1 }; }
class B78 { get(): unknown { return make78().m78; } }
class D78 extends B78 { get(): unknown { return super.get(); } }
function c78(): void { say("record/super-method/map-key", new Map([[(new D78().get()), 1], [(new D78().get()), 2]]).size); }

interface R79 { a79: number; m79: () => number }
function make79(): R79 { return { a79: 1, m79: () => 1 }; }
class B79 { get(): unknown { return make79().m79; } }
class D79 extends B79 { get(): unknown { return super.get(); } }
function c79(): void { say("record/super-method/includes", [(new D79().get())].includes((new D79().get()))); }

interface R80 { a80: number; m80: () => number }
function make80(): R80 { return { a80: 1, m80: () => 1 }; }
class B80 { get(): unknown { return make80().m80; } }
class D80 extends B80 { get(): unknown { return super.get(); } }
function c80(): void { say("record/super-method/index-of", [(new D80().get())].indexOf((new D80().get()))); }

interface R81 { a81: number; m81: () => number }
function make81(): R81 { return { a81: 1, m81: () => 1 }; }
class B81 { get(): unknown { return make81().m81; } }
class D81 extends B81 { get(): unknown { return super.get(); } }
const ws81 = new WeakSet<object>();
function c81(): void { say("record/super-method/weak-set", (ws81.add((new D81().get()) as object), ws81.has((new D81().get()) as object))); }

interface R82 { a82: number; m82: () => number }
function make82(): R82 { return { a82: 1, m82: () => 1 }; }
class B82 { get(): unknown { return make82().m82; } }
class D82 extends B82 { get(): unknown { return super.get(); } }
const wm82 = new WeakMap<object, number>();
function c82(): void { say("record/super-method/weak-map", (wm82.set((new D82().get()) as object, 1), wm82.has((new D82().get()) as object))); }

interface R83 { a83: number; m83: () => number }
function make83(): R83 { return { a83: 1, m83: () => 1 }; }
class B83 { get(): unknown { return make83().m83; } }
class D83 extends B83 { get(): unknown { return super.get(); } }
function c83(): void { say("record/super-method/written", ((((new D83().get())) as any).tag = 1, (((new D83().get())) as any).tag)); }

interface R84 { a84: number; m84: () => number }
function make84(): R84 { return { a84: 1, m84: () => 1 }; }
class B84 { get(): unknown { return make84().m84; } }
class D84 extends B84 { get(): unknown { return super.get(); } }
function c84(): void { say("record/super-method/defined", (Object.defineProperty((new D84().get()) as object, "t", { value: 1 }), "t" in ((new D84().get()) as object))); }

interface R85 { a85: number; m85: () => number }
function make85(): R85 { return { a85: 1, m85: () => 1 }; }
class B85 { get(): unknown { return make85().m85; } }
class D85 extends B85 { get(): unknown { return super.get(); } }
function c85(): void { say("record/super-method/frozen", (Object.freeze((new D85().get())), Object.isFrozen((new D85().get())))); }

interface R86 { a86: number; m86: () => number }
function make86(): R86 { return { a86: 1, m86: () => 1 }; }
class B86 { get(): unknown { return make86().m86; } }
class D86 extends B86 { get(): unknown { return super.get(); } }
function c86(): void { say("record/super-method/prototype-set", (Object.setPrototypeOf((new D86().get()) as object, null), Object.getPrototypeOf((new D86().get())) === null)); }

interface R87 { a87: number; m87: () => number }
function make87(): R87 { return { a87: 1, m87: () => 1 }; }
class B87 { get(): unknown { return make87().m87; } }
class D87 extends B87 { get(): unknown { return super.get(); } }
function c87(): void { say("record/super-method/deleted", (delete (((new D87().get())) as any).length, Object.hasOwn((new D87().get()) as object, "length"))); }

interface R88 { a88: number; m88: () => number }
function make88(): R88 { return { a88: 1, m88: () => 1 }; }
class B88 { get(): unknown { return make88().m88; } }
class D88 extends B88 { get(): unknown { return super.get(); } }
function same88(a: unknown, b: unknown): boolean { return a === b; }
function c88(): void { say("record/super-method/in-a-callee", same88((new D88().get()), (new D88().get()))); }

interface R89 { a89: number; m89: () => number }
function make89(): R89 { return { a89: 1, m89: () => 1 }; }
class B89 { get(): unknown { return make89().m89; } }
class D89 extends B89 { get(): unknown { return super.get(); } }
function hit89(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c89(): void { say("record/super-method/switch", hit89((new D89().get()), (new D89().get()))); }

interface R90 { a90: number; m90: () => number }
function make90(): R90 { return { a90: 1, m90: () => 1 }; }
class B90 { get(): unknown { return make90().m90; } }
class D90 extends B90 { get(): unknown { return super.get(); } }
let last90: unknown;
function seen90(f: unknown): boolean { const same = f === last90; last90 = f; return same; }
function c90(): void { say("record/super-method/kept-then-compared", (seen90((new D90().get())), seen90((new D90().get())))); }

interface R91 { a91: number; m91: () => number }
function make91(): R91 { return { a91: 1, m91: () => 1 }; }
class K91 { constructor(public f: unknown) {} }
function c91(): void { say("record/constructor-parameter/strict-eq", (new K91(make91().m91).f) === (new K91(make91().m91).f)); }

interface R92 { a92: number; m92: () => number }
function make92(): R92 { return { a92: 1, m92: () => 1 }; }
class K92 { constructor(public f: unknown) {} }
function c92(): void { say("record/constructor-parameter/strict-ne", (new K92(make92().m92).f) !== (new K92(make92().m92).f)); }

interface R93 { a93: number; m93: () => number }
function make93(): R93 { return { a93: 1, m93: () => 1 }; }
class K93 { constructor(public f: unknown) {} }
function c93(): void { say("record/constructor-parameter/loose-eq", (new K93(make93().m93).f) == (new K93(make93().m93).f)); }

interface R94 { a94: number; m94: () => number }
function make94(): R94 { return { a94: 1, m94: () => 1 }; }
class K94 { constructor(public f: unknown) {} }
function c94(): void { say("record/constructor-parameter/object-is", Object.is((new K94(make94().m94).f), (new K94(make94().m94).f))); }

interface R95 { a95: number; m95: () => number }
function make95(): R95 { return { a95: 1, m95: () => 1 }; }
class K95 { constructor(public f: unknown) {} }
function c95(): void { say("record/constructor-parameter/set", new Set([(new K95(make95().m95).f), (new K95(make95().m95).f)]).size); }

interface R96 { a96: number; m96: () => number }
function make96(): R96 { return { a96: 1, m96: () => 1 }; }
class K96 { constructor(public f: unknown) {} }
function c96(): void { say("record/constructor-parameter/map-key", new Map([[(new K96(make96().m96).f), 1], [(new K96(make96().m96).f), 2]]).size); }

interface R97 { a97: number; m97: () => number }
function make97(): R97 { return { a97: 1, m97: () => 1 }; }
class K97 { constructor(public f: unknown) {} }
function c97(): void { say("record/constructor-parameter/includes", [(new K97(make97().m97).f)].includes((new K97(make97().m97).f))); }

interface R98 { a98: number; m98: () => number }
function make98(): R98 { return { a98: 1, m98: () => 1 }; }
class K98 { constructor(public f: unknown) {} }
function c98(): void { say("record/constructor-parameter/index-of", [(new K98(make98().m98).f)].indexOf((new K98(make98().m98).f))); }

interface R99 { a99: number; m99: () => number }
function make99(): R99 { return { a99: 1, m99: () => 1 }; }
class K99 { constructor(public f: unknown) {} }
const ws99 = new WeakSet<object>();
function c99(): void { say("record/constructor-parameter/weak-set", (ws99.add((new K99(make99().m99).f) as object), ws99.has((new K99(make99().m99).f) as object))); }

interface R100 { a100: number; m100: () => number }
function make100(): R100 { return { a100: 1, m100: () => 1 }; }
class K100 { constructor(public f: unknown) {} }
const wm100 = new WeakMap<object, number>();
function c100(): void { say("record/constructor-parameter/weak-map", (wm100.set((new K100(make100().m100).f) as object, 1), wm100.has((new K100(make100().m100).f) as object))); }

interface R101 { a101: number; m101: () => number }
function make101(): R101 { return { a101: 1, m101: () => 1 }; }
class K101 { constructor(public f: unknown) {} }
function c101(): void { say("record/constructor-parameter/written", ((((new K101(make101().m101).f)) as any).tag = 1, (((new K101(make101().m101).f)) as any).tag)); }

interface R102 { a102: number; m102: () => number }
function make102(): R102 { return { a102: 1, m102: () => 1 }; }
class K102 { constructor(public f: unknown) {} }
function c102(): void { say("record/constructor-parameter/defined", (Object.defineProperty((new K102(make102().m102).f) as object, "t", { value: 1 }), "t" in ((new K102(make102().m102).f) as object))); }

interface R103 { a103: number; m103: () => number }
function make103(): R103 { return { a103: 1, m103: () => 1 }; }
class K103 { constructor(public f: unknown) {} }
function c103(): void { say("record/constructor-parameter/frozen", (Object.freeze((new K103(make103().m103).f)), Object.isFrozen((new K103(make103().m103).f)))); }

interface R104 { a104: number; m104: () => number }
function make104(): R104 { return { a104: 1, m104: () => 1 }; }
class K104 { constructor(public f: unknown) {} }
function c104(): void { say("record/constructor-parameter/prototype-set", (Object.setPrototypeOf((new K104(make104().m104).f) as object, null), Object.getPrototypeOf((new K104(make104().m104).f)) === null)); }

interface R105 { a105: number; m105: () => number }
function make105(): R105 { return { a105: 1, m105: () => 1 }; }
class K105 { constructor(public f: unknown) {} }
function c105(): void { say("record/constructor-parameter/deleted", (delete (((new K105(make105().m105).f)) as any).length, Object.hasOwn((new K105(make105().m105).f) as object, "length"))); }

interface R106 { a106: number; m106: () => number }
function make106(): R106 { return { a106: 1, m106: () => 1 }; }
class K106 { constructor(public f: unknown) {} }
function same106(a: unknown, b: unknown): boolean { return a === b; }
function c106(): void { say("record/constructor-parameter/in-a-callee", same106((new K106(make106().m106).f), (new K106(make106().m106).f))); }

interface R107 { a107: number; m107: () => number }
function make107(): R107 { return { a107: 1, m107: () => 1 }; }
class K107 { constructor(public f: unknown) {} }
function hit107(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c107(): void { say("record/constructor-parameter/switch", hit107((new K107(make107().m107).f), (new K107(make107().m107).f))); }

interface R108 { a108: number; m108: () => number }
function make108(): R108 { return { a108: 1, m108: () => 1 }; }
class K108 { constructor(public f: unknown) {} }
let last108: unknown;
function seen108(f: unknown): boolean { const same = f === last108; last108 = f; return same; }
function c108(): void { say("record/constructor-parameter/kept-then-compared", (seen108((new K108(make108().m108).f)), seen108((new K108(make108().m108).f)))); }

interface R109 { a109: number; m109: () => number }
function make109(): R109 { return { a109: 1, m109: () => 1 }; }
function tag109(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c109(): void { say("record/tagged-template/strict-eq", (tag109`${make109().m109}`) === (tag109`${make109().m109}`)); }

interface R110 { a110: number; m110: () => number }
function make110(): R110 { return { a110: 1, m110: () => 1 }; }
function tag110(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c110(): void { say("record/tagged-template/strict-ne", (tag110`${make110().m110}`) !== (tag110`${make110().m110}`)); }

interface R111 { a111: number; m111: () => number }
function make111(): R111 { return { a111: 1, m111: () => 1 }; }
function tag111(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c111(): void { say("record/tagged-template/loose-eq", (tag111`${make111().m111}`) == (tag111`${make111().m111}`)); }

interface R112 { a112: number; m112: () => number }
function make112(): R112 { return { a112: 1, m112: () => 1 }; }
function tag112(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c112(): void { say("record/tagged-template/object-is", Object.is((tag112`${make112().m112}`), (tag112`${make112().m112}`))); }

interface R113 { a113: number; m113: () => number }
function make113(): R113 { return { a113: 1, m113: () => 1 }; }
function tag113(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c113(): void { say("record/tagged-template/set", new Set([(tag113`${make113().m113}`), (tag113`${make113().m113}`)]).size); }

interface R114 { a114: number; m114: () => number }
function make114(): R114 { return { a114: 1, m114: () => 1 }; }
function tag114(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c114(): void { say("record/tagged-template/map-key", new Map([[(tag114`${make114().m114}`), 1], [(tag114`${make114().m114}`), 2]]).size); }

interface R115 { a115: number; m115: () => number }
function make115(): R115 { return { a115: 1, m115: () => 1 }; }
function tag115(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c115(): void { say("record/tagged-template/includes", [(tag115`${make115().m115}`)].includes((tag115`${make115().m115}`))); }

interface R116 { a116: number; m116: () => number }
function make116(): R116 { return { a116: 1, m116: () => 1 }; }
function tag116(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c116(): void { say("record/tagged-template/index-of", [(tag116`${make116().m116}`)].indexOf((tag116`${make116().m116}`))); }

interface R117 { a117: number; m117: () => number }
function make117(): R117 { return { a117: 1, m117: () => 1 }; }
function tag117(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
const ws117 = new WeakSet<object>();
function c117(): void { say("record/tagged-template/weak-set", (ws117.add((tag117`${make117().m117}`) as object), ws117.has((tag117`${make117().m117}`) as object))); }

interface R118 { a118: number; m118: () => number }
function make118(): R118 { return { a118: 1, m118: () => 1 }; }
function tag118(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
const wm118 = new WeakMap<object, number>();
function c118(): void { say("record/tagged-template/weak-map", (wm118.set((tag118`${make118().m118}`) as object, 1), wm118.has((tag118`${make118().m118}`) as object))); }

interface R119 { a119: number; m119: () => number }
function make119(): R119 { return { a119: 1, m119: () => 1 }; }
function tag119(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c119(): void { say("record/tagged-template/written", ((((tag119`${make119().m119}`)) as any).tag = 1, (((tag119`${make119().m119}`)) as any).tag)); }

interface R120 { a120: number; m120: () => number }
function make120(): R120 { return { a120: 1, m120: () => 1 }; }
function tag120(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c120(): void { say("record/tagged-template/defined", (Object.defineProperty((tag120`${make120().m120}`) as object, "t", { value: 1 }), "t" in ((tag120`${make120().m120}`) as object))); }

c61(); c62(); c63(); c64(); c65(); c66(); c67(); c68(); c69(); c70(); c71(); c72(); c73(); c74(); c75(); c76(); c77(); c78(); c79(); c80(); c81(); c82(); c83(); c84(); c85(); c86(); c87(); c88(); c89(); c90(); c91(); c92(); c93(); c94(); c95(); c96(); c97(); c98(); c99(); c100(); c101(); c102(); c103(); c104(); c105(); c106(); c107(); c108(); c109(); c110(); c111(); c112(); c113(); c114(); c115(); c116(); c117(); c118(); c119(); c120();
console.log(out.join("\n"));
