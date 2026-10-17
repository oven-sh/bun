// Generated program: object and closure identity stays observable when allocations are removed (part 10).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R612 { a612: number; m612: () => number }
interface O612 { in612: R612; n612: number }
function make612(): O612 { return { in612: { a612: 1, m612: () => 1 }, n612: 2 }; }
function get612(): unknown { return make612().in612.m612; }
function c612(): void { say("nested/getter/set", new Set([(get612()), (get612())]).size); }

interface R613 { a613: number; m613: () => number }
interface O613 { in613: R613; n613: number }
function make613(): O613 { return { in613: { a613: 1, m613: () => 1 }, n613: 2 }; }
function get613(): unknown { return make613().in613.m613; }
function c613(): void { say("nested/getter/map-key", new Map([[(get613()), 1], [(get613()), 2]]).size); }

interface R614 { a614: number; m614: () => number }
interface O614 { in614: R614; n614: number }
function make614(): O614 { return { in614: { a614: 1, m614: () => 1 }, n614: 2 }; }
function get614(): unknown { return make614().in614.m614; }
function c614(): void { say("nested/getter/includes", [(get614())].includes((get614()))); }

interface R615 { a615: number; m615: () => number }
interface O615 { in615: R615; n615: number }
function make615(): O615 { return { in615: { a615: 1, m615: () => 1 }, n615: 2 }; }
function get615(): unknown { return make615().in615.m615; }
function c615(): void { say("nested/getter/index-of", [(get615())].indexOf((get615()))); }

interface R616 { a616: number; m616: () => number }
interface O616 { in616: R616; n616: number }
function make616(): O616 { return { in616: { a616: 1, m616: () => 1 }, n616: 2 }; }
function get616(): unknown { return make616().in616.m616; }
const ws616 = new WeakSet<object>();
function c616(): void { say("nested/getter/weak-set", (ws616.add((get616()) as object), ws616.has((get616()) as object))); }

interface R617 { a617: number; m617: () => number }
interface O617 { in617: R617; n617: number }
function make617(): O617 { return { in617: { a617: 1, m617: () => 1 }, n617: 2 }; }
function get617(): unknown { return make617().in617.m617; }
const wm617 = new WeakMap<object, number>();
function c617(): void { say("nested/getter/weak-map", (wm617.set((get617()) as object, 1), wm617.has((get617()) as object))); }

interface R618 { a618: number; m618: () => number }
interface O618 { in618: R618; n618: number }
function make618(): O618 { return { in618: { a618: 1, m618: () => 1 }, n618: 2 }; }
function get618(): unknown { return make618().in618.m618; }
function c618(): void { say("nested/getter/written", ((((get618())) as any).tag = 1, (((get618())) as any).tag)); }

interface R619 { a619: number; m619: () => number }
interface O619 { in619: R619; n619: number }
function make619(): O619 { return { in619: { a619: 1, m619: () => 1 }, n619: 2 }; }
function get619(): unknown { return make619().in619.m619; }
function c619(): void { say("nested/getter/defined", (Object.defineProperty((get619()) as object, "t", { value: 1 }), "t" in ((get619()) as object))); }

interface R620 { a620: number; m620: () => number }
interface O620 { in620: R620; n620: number }
function make620(): O620 { return { in620: { a620: 1, m620: () => 1 }, n620: 2 }; }
function get620(): unknown { return make620().in620.m620; }
function c620(): void { say("nested/getter/frozen", (Object.freeze((get620())), Object.isFrozen((get620())))); }

interface R621 { a621: number; m621: () => number }
interface O621 { in621: R621; n621: number }
function make621(): O621 { return { in621: { a621: 1, m621: () => 1 }, n621: 2 }; }
function get621(): unknown { return make621().in621.m621; }
function c621(): void { say("nested/getter/prototype-set", (Object.setPrototypeOf((get621()) as object, null), Object.getPrototypeOf((get621())) === null)); }

interface R622 { a622: number; m622: () => number }
interface O622 { in622: R622; n622: number }
function make622(): O622 { return { in622: { a622: 1, m622: () => 1 }, n622: 2 }; }
function get622(): unknown { return make622().in622.m622; }
function c622(): void { say("nested/getter/deleted", (delete (((get622())) as any).length, Object.hasOwn((get622()) as object, "length"))); }

interface R623 { a623: number; m623: () => number }
interface O623 { in623: R623; n623: number }
function make623(): O623 { return { in623: { a623: 1, m623: () => 1 }, n623: 2 }; }
function get623(): unknown { return make623().in623.m623; }
function same623(a: unknown, b: unknown): boolean { return a === b; }
function c623(): void { say("nested/getter/in-a-callee", same623((get623()), (get623()))); }

interface R624 { a624: number; m624: () => number }
interface O624 { in624: R624; n624: number }
function make624(): O624 { return { in624: { a624: 1, m624: () => 1 }, n624: 2 }; }
function get624(): unknown { return make624().in624.m624; }
function hit624(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c624(): void { say("nested/getter/switch", hit624((get624()), (get624()))); }

interface R625 { a625: number; m625: () => number }
interface O625 { in625: R625; n625: number }
function make625(): O625 { return { in625: { a625: 1, m625: () => 1 }, n625: 2 }; }
function get625(): unknown { return make625().in625.m625; }
let last625: unknown;
function seen625(f: unknown): boolean { const same = f === last625; last625 = f; return same; }
function c625(): void { say("nested/getter/kept-then-compared", (seen625((get625())), seen625((get625())))); }

function make626(): Array<() => number> { return [() => 1]; }
function c626(): void { say("array/inline/strict-eq", (make626()[0]) === (make626()[0])); }

function make627(): Array<() => number> { return [() => 1]; }
function get627(): unknown { return make627()[0]; }
function c627(): void { say("array/getter/strict-eq", (get627()) === (get627())); }

function make628(): Array<() => number> { return [() => 1]; }
function get628a(): unknown { return make628()[0]; }
function get628b(): unknown { return get628a(); }
function get628(): unknown { return get628b(); }
function c628(): void { say("array/forwarded/strict-eq", (get628()) === (get628())); }

function make629(): Array<() => number> { return [() => 1]; }
function pick629(x: Array<() => number>): unknown { return x[0]; }
function c629(): void { say("array/picked/strict-eq", (pick629(make629())) === (pick629(make629()))); }

function make630(): Array<() => number> { return [() => 1]; }
function pick630(x: Array<() => number>): unknown { return x[0]; }
function get630(): unknown { return pick630(make630()); }
function c630(): void { say("array/picked-and-returned/strict-eq", (get630()) === (get630())); }

function make631(): Array<() => number> { return [() => 1]; }
let slot631: unknown;
function put631(): unknown { slot631 = make631()[0]; return 0; }
function c631(): void { say("array/variable/strict-eq", ((put631(), slot631)) === ((put631(), slot631))); }

function make632(): Array<() => number> { return [() => 1]; }
let kept632: Array<() => number> | undefined;
function keep632(): unknown { kept632 = make632(); return 0; }
function c632(): void { say("array/holder-in-a-variable/strict-eq", ((keep632(), kept632![0])) === ((keep632(), kept632![0]))); }

function make633(): Array<() => number> { return [() => 1]; }
function with633<T>(k: (f: unknown) => T): T { return k(make633()[0]); }
function c633(): void { say("array/callback/strict-eq", (with633(x => x)) === (with633(x => x))); }

function make634(): Array<() => number> { return [() => 1]; }
function later634(): () => unknown { const t = make634(); return () => t[0]; }
function c634(): void { say("array/closure/strict-eq", (later634()()) === (later634()())); }

function make635(): Array<() => number> { return [() => 1]; }
function later635(): () => unknown { const f = make635()[0]; return () => f; }
function c635(): void { say("array/captured/strict-eq", (later635()()) === (later635()())); }

function make636(): Array<() => number> { return [() => 1]; }
function wrap636(): { f: unknown } { return { f: make636()[0] }; }
function c636(): void { say("array/rewrapped/strict-eq", (wrap636().f) === (wrap636().f)); }

function make637(): Array<() => number> { return [() => 1]; }
function wrap637(): unknown[] { return [make637()[0]]; }
function c637(): void { say("array/rewrapped-in-an-array/strict-eq", (wrap637()[0]) === (wrap637()[0])); }

function make638(): Array<() => number> { return [() => 1]; }
function* gen638(): Generator<unknown> { yield make638()[0]; }
function c638(): void { say("array/generator/strict-eq", (gen638().next().value) === (gen638().next().value)); }

function make639(): Array<() => number> { return [() => 1]; }
class K639 { get(): unknown { return make639()[0]; } }
function c639(): void { say("array/method/strict-eq", (new K639().get()) === (new K639().get())); }

function make640(): Array<() => number> { return [() => 1]; }
class K640 { get f(): unknown { return make640()[0]; } }
function c640(): void { say("array/accessor/strict-eq", (new K640().f) === (new K640().f)); }

function make641(): Array<() => number> { return [() => 1]; }
function first641(...xs: unknown[]): unknown { return xs[0]; }
function c641(): void { say("array/rest/strict-eq", (first641(make641()[0])) === (first641(make641()[0]))); }

function make642(): Array<() => number> { return [() => 1]; }
function get642(): unknown { try { throw make642()[0]; } catch (e) { return e; } }
function c642(): void { say("array/thrown/strict-eq", (get642()) === (get642())); }

function make643(): Array<() => number> { return [() => 1]; }
function get643(other: unknown, which: boolean): unknown { return which ? make643()[0] : other; }
function c643(): void { say("array/one-arm/strict-eq", (get643(0, true)) === (get643(0, true))); }

function make644(): Array<() => number> { return [() => 1]; }
function get644(): unknown { let t = make644(); for (let i = 0; i < 2; i++) t = make644(); return t[0]; }
function c644(): void { say("array/loop/strict-eq", (get644()) === (get644())); }

function make645(): Array<() => number> { return [() => 1]; }
function id645<T>(x: T): T { return x; }
function get645(): unknown { return id645(make645())[0]; }
function c645(): void { say("array/identity/strict-eq", (get645()) === (get645())); }

function make646(): Array<() => number> { return [() => 1]; }
function get646(): unknown { return make646()[0]; }
const g646 = [get646];
function c646(): void { say("array/by-value/strict-eq", (g646[0]()) === (g646[0]())); }

function make658(): Array<() => number> { return [() => 1]; }
function get658(): unknown { return make658()[0]; }
function c658(): void { say("array/getter/strict-ne", (get658()) !== (get658())); }

function make659(): Array<() => number> { return [() => 1]; }
function get659(): unknown { return make659()[0]; }
function c659(): void { say("array/getter/loose-eq", (get659()) == (get659())); }

function make660(): Array<() => number> { return [() => 1]; }
function get660(): unknown { return make660()[0]; }
function c660(): void { say("array/getter/object-is", Object.is((get660()), (get660()))); }

function make661(): Array<() => number> { return [() => 1]; }
function get661(): unknown { return make661()[0]; }
function c661(): void { say("array/getter/set", new Set([(get661()), (get661())]).size); }

function make662(): Array<() => number> { return [() => 1]; }
function get662(): unknown { return make662()[0]; }
function c662(): void { say("array/getter/map-key", new Map([[(get662()), 1], [(get662()), 2]]).size); }

function make663(): Array<() => number> { return [() => 1]; }
function get663(): unknown { return make663()[0]; }
function c663(): void { say("array/getter/includes", [(get663())].includes((get663()))); }

function make664(): Array<() => number> { return [() => 1]; }
function get664(): unknown { return make664()[0]; }
function c664(): void { say("array/getter/index-of", [(get664())].indexOf((get664()))); }

function make665(): Array<() => number> { return [() => 1]; }
function get665(): unknown { return make665()[0]; }
const ws665 = new WeakSet<object>();
function c665(): void { say("array/getter/weak-set", (ws665.add((get665()) as object), ws665.has((get665()) as object))); }

function make666(): Array<() => number> { return [() => 1]; }
function get666(): unknown { return make666()[0]; }
const wm666 = new WeakMap<object, number>();
function c666(): void { say("array/getter/weak-map", (wm666.set((get666()) as object, 1), wm666.has((get666()) as object))); }

function make667(): Array<() => number> { return [() => 1]; }
function get667(): unknown { return make667()[0]; }
function c667(): void { say("array/getter/written", ((((get667())) as any).tag = 1, (((get667())) as any).tag)); }

function make668(): Array<() => number> { return [() => 1]; }
function get668(): unknown { return make668()[0]; }
function c668(): void { say("array/getter/defined", (Object.defineProperty((get668()) as object, "t", { value: 1 }), "t" in ((get668()) as object))); }

function make669(): Array<() => number> { return [() => 1]; }
function get669(): unknown { return make669()[0]; }
function c669(): void { say("array/getter/frozen", (Object.freeze((get669())), Object.isFrozen((get669())))); }

function make670(): Array<() => number> { return [() => 1]; }
function get670(): unknown { return make670()[0]; }
function c670(): void { say("array/getter/prototype-set", (Object.setPrototypeOf((get670()) as object, null), Object.getPrototypeOf((get670())) === null)); }

function make671(): Array<() => number> { return [() => 1]; }
function get671(): unknown { return make671()[0]; }
function c671(): void { say("array/getter/deleted", (delete (((get671())) as any).length, Object.hasOwn((get671()) as object, "length"))); }

function make672(): Array<() => number> { return [() => 1]; }
function get672(): unknown { return make672()[0]; }
function same672(a: unknown, b: unknown): boolean { return a === b; }
function c672(): void { say("array/getter/in-a-callee", same672((get672()), (get672()))); }

function make673(): Array<() => number> { return [() => 1]; }
function get673(): unknown { return make673()[0]; }
function hit673(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c673(): void { say("array/getter/switch", hit673((get673()), (get673()))); }

function make674(): Array<() => number> { return [() => 1]; }
function get674(): unknown { return make674()[0]; }
let last674: unknown;
function seen674(f: unknown): boolean { const same = f === last674; last674 = f; return same; }
function c674(): void { say("array/getter/kept-then-compared", (seen674((get674())), seen674((get674())))); }

interface R675 { a675: number; m675: () => number }
function make675(): R675[] { return [{ a675: 1, m675: () => 1 }]; }
function c675(): void { say("records/inline/strict-eq", (make675()[0].m675) === (make675()[0].m675)); }

interface R676 { a676: number; m676: () => number }
function make676(): R676[] { return [{ a676: 1, m676: () => 1 }]; }
function get676(): unknown { return make676()[0].m676; }
function c676(): void { say("records/getter/strict-eq", (get676()) === (get676())); }

interface R677 { a677: number; m677: () => number }
function make677(): R677[] { return [{ a677: 1, m677: () => 1 }]; }
function get677a(): unknown { return make677()[0].m677; }
function get677b(): unknown { return get677a(); }
function get677(): unknown { return get677b(); }
function c677(): void { say("records/forwarded/strict-eq", (get677()) === (get677())); }

interface R678 { a678: number; m678: () => number }
function make678(): R678[] { return [{ a678: 1, m678: () => 1 }]; }
function pick678(x: R678[]): unknown { return x[0].m678; }
function c678(): void { say("records/picked/strict-eq", (pick678(make678())) === (pick678(make678()))); }

interface R679 { a679: number; m679: () => number }
function make679(): R679[] { return [{ a679: 1, m679: () => 1 }]; }
function pick679(x: R679[]): unknown { return x[0].m679; }
function get679(): unknown { return pick679(make679()); }
function c679(): void { say("records/picked-and-returned/strict-eq", (get679()) === (get679())); }

interface R680 { a680: number; m680: () => number }
function make680(): R680[] { return [{ a680: 1, m680: () => 1 }]; }
let slot680: unknown;
function put680(): unknown { slot680 = make680()[0].m680; return 0; }
function c680(): void { say("records/variable/strict-eq", ((put680(), slot680)) === ((put680(), slot680))); }

interface R681 { a681: number; m681: () => number }
function make681(): R681[] { return [{ a681: 1, m681: () => 1 }]; }
let kept681: R681[] | undefined;
function keep681(): unknown { kept681 = make681(); return 0; }
function c681(): void { say("records/holder-in-a-variable/strict-eq", ((keep681(), kept681![0].m681)) === ((keep681(), kept681![0].m681))); }

interface R682 { a682: number; m682: () => number }
function make682(): R682[] { return [{ a682: 1, m682: () => 1 }]; }
function with682<T>(k: (f: unknown) => T): T { return k(make682()[0].m682); }
function c682(): void { say("records/callback/strict-eq", (with682(x => x)) === (with682(x => x))); }

c612(); c613(); c614(); c615(); c616(); c617(); c618(); c619(); c620(); c621(); c622(); c623(); c624(); c625(); c626(); c627(); c628(); c629(); c630(); c631(); c632(); c633(); c634(); c635(); c636(); c637(); c638(); c639(); c640(); c641(); c642(); c643(); c644(); c645(); c646(); c658(); c659(); c660(); c661(); c662(); c663(); c664(); c665(); c666(); c667(); c668(); c669(); c670(); c671(); c672(); c673(); c674(); c675(); c676(); c677(); c678(); c679(); c680(); c681(); c682();
console.log(out.join("\n"));
