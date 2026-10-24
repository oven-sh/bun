// Generated program: object and closure identity stays observable when allocations are removed (part 11).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R683 { a683: number; m683: () => number }
function make683(): R683[] { return [{ a683: 1, m683: () => 1 }]; }
function later683(): () => unknown { const t = make683(); return () => t[0].m683; }
function c683(): void { say("records/closure/strict-eq", (later683()()) === (later683()())); }

interface R684 { a684: number; m684: () => number }
function make684(): R684[] { return [{ a684: 1, m684: () => 1 }]; }
function later684(): () => unknown { const f = make684()[0].m684; return () => f; }
function c684(): void { say("records/captured/strict-eq", (later684()()) === (later684()())); }

interface R685 { a685: number; m685: () => number }
function make685(): R685[] { return [{ a685: 1, m685: () => 1 }]; }
function wrap685(): { f: unknown } { return { f: make685()[0].m685 }; }
function c685(): void { say("records/rewrapped/strict-eq", (wrap685().f) === (wrap685().f)); }

interface R686 { a686: number; m686: () => number }
function make686(): R686[] { return [{ a686: 1, m686: () => 1 }]; }
function wrap686(): unknown[] { return [make686()[0].m686]; }
function c686(): void { say("records/rewrapped-in-an-array/strict-eq", (wrap686()[0]) === (wrap686()[0])); }

interface R687 { a687: number; m687: () => number }
function make687(): R687[] { return [{ a687: 1, m687: () => 1 }]; }
function* gen687(): Generator<unknown> { yield make687()[0].m687; }
function c687(): void { say("records/generator/strict-eq", (gen687().next().value) === (gen687().next().value)); }

interface R688 { a688: number; m688: () => number }
function make688(): R688[] { return [{ a688: 1, m688: () => 1 }]; }
class K688 { get(): unknown { return make688()[0].m688; } }
function c688(): void { say("records/method/strict-eq", (new K688().get()) === (new K688().get())); }

interface R689 { a689: number; m689: () => number }
function make689(): R689[] { return [{ a689: 1, m689: () => 1 }]; }
class K689 { get f(): unknown { return make689()[0].m689; } }
function c689(): void { say("records/accessor/strict-eq", (new K689().f) === (new K689().f)); }

interface R690 { a690: number; m690: () => number }
function make690(): R690[] { return [{ a690: 1, m690: () => 1 }]; }
function first690(...xs: unknown[]): unknown { return xs[0]; }
function c690(): void { say("records/rest/strict-eq", (first690(make690()[0].m690)) === (first690(make690()[0].m690))); }

interface R691 { a691: number; m691: () => number }
function make691(): R691[] { return [{ a691: 1, m691: () => 1 }]; }
function get691(): unknown { try { throw make691()[0].m691; } catch (e) { return e; } }
function c691(): void { say("records/thrown/strict-eq", (get691()) === (get691())); }

interface R692 { a692: number; m692: () => number }
function make692(): R692[] { return [{ a692: 1, m692: () => 1 }]; }
function get692(other: unknown, which: boolean): unknown { return which ? make692()[0].m692 : other; }
function c692(): void { say("records/one-arm/strict-eq", (get692(0, true)) === (get692(0, true))); }

interface R693 { a693: number; m693: () => number }
function make693(): R693[] { return [{ a693: 1, m693: () => 1 }]; }
function get693(): unknown { let t = make693(); for (let i = 0; i < 2; i++) t = make693(); return t[0].m693; }
function c693(): void { say("records/loop/strict-eq", (get693()) === (get693())); }

interface R694 { a694: number; m694: () => number }
function make694(): R694[] { return [{ a694: 1, m694: () => 1 }]; }
function id694<T>(x: T): T { return x; }
function get694(): unknown { return id694(make694())[0].m694; }
function c694(): void { say("records/identity/strict-eq", (get694()) === (get694())); }

interface R695 { a695: number; m695: () => number }
function make695(): R695[] { return [{ a695: 1, m695: () => 1 }]; }
function get695(): unknown { return make695()[0].m695; }
const g695 = [get695];
function c695(): void { say("records/by-value/strict-eq", (g695[0]()) === (g695[0]())); }

interface R707 { a707: number; m707: () => number }
function make707(): R707[] { return [{ a707: 1, m707: () => 1 }]; }
function get707(): unknown { return make707()[0].m707; }
function c707(): void { say("records/getter/strict-ne", (get707()) !== (get707())); }

interface R708 { a708: number; m708: () => number }
function make708(): R708[] { return [{ a708: 1, m708: () => 1 }]; }
function get708(): unknown { return make708()[0].m708; }
function c708(): void { say("records/getter/loose-eq", (get708()) == (get708())); }

interface R709 { a709: number; m709: () => number }
function make709(): R709[] { return [{ a709: 1, m709: () => 1 }]; }
function get709(): unknown { return make709()[0].m709; }
function c709(): void { say("records/getter/object-is", Object.is((get709()), (get709()))); }

interface R710 { a710: number; m710: () => number }
function make710(): R710[] { return [{ a710: 1, m710: () => 1 }]; }
function get710(): unknown { return make710()[0].m710; }
function c710(): void { say("records/getter/set", new Set([(get710()), (get710())]).size); }

interface R711 { a711: number; m711: () => number }
function make711(): R711[] { return [{ a711: 1, m711: () => 1 }]; }
function get711(): unknown { return make711()[0].m711; }
function c711(): void { say("records/getter/map-key", new Map([[(get711()), 1], [(get711()), 2]]).size); }

interface R712 { a712: number; m712: () => number }
function make712(): R712[] { return [{ a712: 1, m712: () => 1 }]; }
function get712(): unknown { return make712()[0].m712; }
function c712(): void { say("records/getter/includes", [(get712())].includes((get712()))); }

interface R713 { a713: number; m713: () => number }
function make713(): R713[] { return [{ a713: 1, m713: () => 1 }]; }
function get713(): unknown { return make713()[0].m713; }
function c713(): void { say("records/getter/index-of", [(get713())].indexOf((get713()))); }

interface R714 { a714: number; m714: () => number }
function make714(): R714[] { return [{ a714: 1, m714: () => 1 }]; }
function get714(): unknown { return make714()[0].m714; }
const ws714 = new WeakSet<object>();
function c714(): void { say("records/getter/weak-set", (ws714.add((get714()) as object), ws714.has((get714()) as object))); }

interface R715 { a715: number; m715: () => number }
function make715(): R715[] { return [{ a715: 1, m715: () => 1 }]; }
function get715(): unknown { return make715()[0].m715; }
const wm715 = new WeakMap<object, number>();
function c715(): void { say("records/getter/weak-map", (wm715.set((get715()) as object, 1), wm715.has((get715()) as object))); }

interface R716 { a716: number; m716: () => number }
function make716(): R716[] { return [{ a716: 1, m716: () => 1 }]; }
function get716(): unknown { return make716()[0].m716; }
function c716(): void { say("records/getter/written", ((((get716())) as any).tag = 1, (((get716())) as any).tag)); }

interface R717 { a717: number; m717: () => number }
function make717(): R717[] { return [{ a717: 1, m717: () => 1 }]; }
function get717(): unknown { return make717()[0].m717; }
function c717(): void { say("records/getter/defined", (Object.defineProperty((get717()) as object, "t", { value: 1 }), "t" in ((get717()) as object))); }

interface R718 { a718: number; m718: () => number }
function make718(): R718[] { return [{ a718: 1, m718: () => 1 }]; }
function get718(): unknown { return make718()[0].m718; }
function c718(): void { say("records/getter/frozen", (Object.freeze((get718())), Object.isFrozen((get718())))); }

interface R719 { a719: number; m719: () => number }
function make719(): R719[] { return [{ a719: 1, m719: () => 1 }]; }
function get719(): unknown { return make719()[0].m719; }
function c719(): void { say("records/getter/prototype-set", (Object.setPrototypeOf((get719()) as object, null), Object.getPrototypeOf((get719())) === null)); }

interface R720 { a720: number; m720: () => number }
function make720(): R720[] { return [{ a720: 1, m720: () => 1 }]; }
function get720(): unknown { return make720()[0].m720; }
function c720(): void { say("records/getter/deleted", (delete (((get720())) as any).length, Object.hasOwn((get720()) as object, "length"))); }

interface R721 { a721: number; m721: () => number }
function make721(): R721[] { return [{ a721: 1, m721: () => 1 }]; }
function get721(): unknown { return make721()[0].m721; }
function same721(a: unknown, b: unknown): boolean { return a === b; }
function c721(): void { say("records/getter/in-a-callee", same721((get721()), (get721()))); }

interface R722 { a722: number; m722: () => number }
function make722(): R722[] { return [{ a722: 1, m722: () => 1 }]; }
function get722(): unknown { return make722()[0].m722; }
function hit722(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c722(): void { say("records/getter/switch", hit722((get722()), (get722()))); }

interface R723 { a723: number; m723: () => number }
function make723(): R723[] { return [{ a723: 1, m723: () => 1 }]; }
function get723(): unknown { return make723()[0].m723; }
let last723: unknown;
function seen723(f: unknown): boolean { const same = f === last723; last723 = f; return same; }
function c723(): void { say("records/getter/kept-then-compared", (seen723((get723())), seen723((get723())))); }

function make724(): () => number { return () => 1; }
function c724(): void { say("bare/inline/strict-eq", (make724()) === (make724())); }

function make725(): () => number { return () => 1; }
function get725(): unknown { return make725(); }
function c725(): void { say("bare/getter/strict-eq", (get725()) === (get725())); }

function make726(): () => number { return () => 1; }
function get726a(): unknown { return make726(); }
function get726b(): unknown { return get726a(); }
function get726(): unknown { return get726b(); }
function c726(): void { say("bare/forwarded/strict-eq", (get726()) === (get726())); }

function make727(): () => number { return () => 1; }
function pick727(x: () => number): unknown { return x; }
function c727(): void { say("bare/picked/strict-eq", (pick727(make727())) === (pick727(make727()))); }

function make728(): () => number { return () => 1; }
function pick728(x: () => number): unknown { return x; }
function get728(): unknown { return pick728(make728()); }
function c728(): void { say("bare/picked-and-returned/strict-eq", (get728()) === (get728())); }

function make729(): () => number { return () => 1; }
let slot729: unknown;
function put729(): unknown { slot729 = make729(); return 0; }
function c729(): void { say("bare/variable/strict-eq", ((put729(), slot729)) === ((put729(), slot729))); }

function make730(): () => number { return () => 1; }
let kept730: () => number | undefined;
function keep730(): unknown { kept730 = make730(); return 0; }
function c730(): void { say("bare/holder-in-a-variable/strict-eq", ((keep730(), kept730!)) === ((keep730(), kept730!))); }

function make731(): () => number { return () => 1; }
function with731<T>(k: (f: unknown) => T): T { return k(make731()); }
function c731(): void { say("bare/callback/strict-eq", (with731(x => x)) === (with731(x => x))); }

function make732(): () => number { return () => 1; }
function later732(): () => unknown { const t = make732(); return () => t; }
function c732(): void { say("bare/closure/strict-eq", (later732()()) === (later732()())); }

function make733(): () => number { return () => 1; }
function later733(): () => unknown { const f = make733(); return () => f; }
function c733(): void { say("bare/captured/strict-eq", (later733()()) === (later733()())); }

function make734(): () => number { return () => 1; }
function wrap734(): { f: unknown } { return { f: make734() }; }
function c734(): void { say("bare/rewrapped/strict-eq", (wrap734().f) === (wrap734().f)); }

function make735(): () => number { return () => 1; }
function wrap735(): unknown[] { return [make735()]; }
function c735(): void { say("bare/rewrapped-in-an-array/strict-eq", (wrap735()[0]) === (wrap735()[0])); }

function make736(): () => number { return () => 1; }
function* gen736(): Generator<unknown> { yield make736(); }
function c736(): void { say("bare/generator/strict-eq", (gen736().next().value) === (gen736().next().value)); }

function make737(): () => number { return () => 1; }
class K737 { get(): unknown { return make737(); } }
function c737(): void { say("bare/method/strict-eq", (new K737().get()) === (new K737().get())); }

function make738(): () => number { return () => 1; }
class K738 { get f(): unknown { return make738(); } }
function c738(): void { say("bare/accessor/strict-eq", (new K738().f) === (new K738().f)); }

function make739(): () => number { return () => 1; }
function first739(...xs: unknown[]): unknown { return xs[0]; }
function c739(): void { say("bare/rest/strict-eq", (first739(make739())) === (first739(make739()))); }

function make740(): () => number { return () => 1; }
function get740(): unknown { try { throw make740(); } catch (e) { return e; } }
function c740(): void { say("bare/thrown/strict-eq", (get740()) === (get740())); }

function make741(): () => number { return () => 1; }
function get741(other: unknown, which: boolean): unknown { return which ? make741() : other; }
function c741(): void { say("bare/one-arm/strict-eq", (get741(0, true)) === (get741(0, true))); }

function make742(): () => number { return () => 1; }
function get742(): unknown { let t = make742(); for (let i = 0; i < 2; i++) t = make742(); return t; }
function c742(): void { say("bare/loop/strict-eq", (get742()) === (get742())); }

function make743(): () => number { return () => 1; }
function id743<T>(x: T): T { return x; }
function get743(): unknown { return id743(make743()); }
function c743(): void { say("bare/identity/strict-eq", (get743()) === (get743())); }

function make744(): () => number { return () => 1; }
function get744(): unknown { return make744(); }
const g744 = [get744];
function c744(): void { say("bare/by-value/strict-eq", (g744[0]()) === (g744[0]())); }

function make756(): () => number { return () => 1; }
function get756(): unknown { return make756(); }
function c756(): void { say("bare/getter/strict-ne", (get756()) !== (get756())); }

function make757(): () => number { return () => 1; }
function get757(): unknown { return make757(); }
function c757(): void { say("bare/getter/loose-eq", (get757()) == (get757())); }

function make758(): () => number { return () => 1; }
function get758(): unknown { return make758(); }
function c758(): void { say("bare/getter/object-is", Object.is((get758()), (get758()))); }

function make759(): () => number { return () => 1; }
function get759(): unknown { return make759(); }
function c759(): void { say("bare/getter/set", new Set([(get759()), (get759())]).size); }

function make760(): () => number { return () => 1; }
function get760(): unknown { return make760(); }
function c760(): void { say("bare/getter/map-key", new Map([[(get760()), 1], [(get760()), 2]]).size); }

function make761(): () => number { return () => 1; }
function get761(): unknown { return make761(); }
function c761(): void { say("bare/getter/includes", [(get761())].includes((get761()))); }

function make762(): () => number { return () => 1; }
function get762(): unknown { return make762(); }
function c762(): void { say("bare/getter/index-of", [(get762())].indexOf((get762()))); }

function make763(): () => number { return () => 1; }
function get763(): unknown { return make763(); }
const ws763 = new WeakSet<object>();
function c763(): void { say("bare/getter/weak-set", (ws763.add((get763()) as object), ws763.has((get763()) as object))); }

function make764(): () => number { return () => 1; }
function get764(): unknown { return make764(); }
const wm764 = new WeakMap<object, number>();
function c764(): void { say("bare/getter/weak-map", (wm764.set((get764()) as object, 1), wm764.has((get764()) as object))); }

c683(); c684(); c685(); c686(); c687(); c688(); c689(); c690(); c691(); c692(); c693(); c694(); c695(); c707(); c708(); c709(); c710(); c711(); c712(); c713(); c714(); c715(); c716(); c717(); c718(); c719(); c720(); c721(); c722(); c723(); c724(); c725(); c726(); c727(); c728(); c729(); c730(); c731(); c732(); c733(); c734(); c735(); c736(); c737(); c738(); c739(); c740(); c741(); c742(); c743(); c744(); c756(); c757(); c758(); c759(); c760(); c761(); c762(); c763(); c764();
console.log(out.join("\n"));
