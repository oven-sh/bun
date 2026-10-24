// Generated program: object and closure identity stays observable when allocations are removed (part 13).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R836 { a836: number; m836?: () => number }
function make836(): R836 { const r: R836 = { a836: 1 }; r.m836 = () => 1; return r; }
class K836 { get f(): unknown { return make836().m836; } }
function c836(): void { say("stored-later/accessor/strict-eq", (new K836().f) === (new K836().f)); }

interface R837 { a837: number; m837?: () => number }
function make837(): R837 { const r: R837 = { a837: 1 }; r.m837 = () => 1; return r; }
function first837(...xs: unknown[]): unknown { return xs[0]; }
function c837(): void { say("stored-later/rest/strict-eq", (first837(make837().m837)) === (first837(make837().m837))); }

interface R838 { a838: number; m838?: () => number }
function make838(): R838 { const r: R838 = { a838: 1 }; r.m838 = () => 1; return r; }
function get838(): unknown { try { throw make838().m838; } catch (e) { return e; } }
function c838(): void { say("stored-later/thrown/strict-eq", (get838()) === (get838())); }

interface R839 { a839: number; m839?: () => number }
function make839(): R839 { const r: R839 = { a839: 1 }; r.m839 = () => 1; return r; }
function get839(other: unknown, which: boolean): unknown { return which ? make839().m839 : other; }
function c839(): void { say("stored-later/one-arm/strict-eq", (get839(0, true)) === (get839(0, true))); }

interface R840 { a840: number; m840?: () => number }
function make840(): R840 { const r: R840 = { a840: 1 }; r.m840 = () => 1; return r; }
function get840(): unknown { let t = make840(); for (let i = 0; i < 2; i++) t = make840(); return t.m840; }
function c840(): void { say("stored-later/loop/strict-eq", (get840()) === (get840())); }

interface R841 { a841: number; m841?: () => number }
function make841(): R841 { const r: R841 = { a841: 1 }; r.m841 = () => 1; return r; }
function id841<T>(x: T): T { return x; }
function get841(): unknown { return id841(make841()).m841; }
function c841(): void { say("stored-later/identity/strict-eq", (get841()) === (get841())); }

interface R842 { a842: number; m842?: () => number }
function make842(): R842 { const r: R842 = { a842: 1 }; r.m842 = () => 1; return r; }
function get842(): unknown { return make842().m842; }
const g842 = [get842];
function c842(): void { say("stored-later/by-value/strict-eq", (g842[0]()) === (g842[0]())); }

interface R843 { a843: number; m843?: () => number }
function make843(): R843 { const r: R843 = { a843: 1 }; r.m843 = () => 1; return r; }
function c843(): void { say("stored-later/values/strict-eq", (Object.values(make843())[1]) === (Object.values(make843())[1])); }

interface R844 { a844: number; m844?: () => number }
function make844(): R844 { const r: R844 = { a844: 1 }; r.m844 = () => 1; return r; }
function get844(): unknown { return Object.values(make844())[1]; }
function c844(): void { say("stored-later/values-returned/strict-eq", (get844()) === (get844())); }

interface R845 { a845: number; m845?: () => number }
function make845(): R845 { const r: R845 = { a845: 1 }; r.m845 = () => 1; return r; }
function c845(): void { say("stored-later/entries/strict-eq", (Object.entries(make845())[1][1]) === (Object.entries(make845())[1][1])); }

interface R846 { a846: number; m846?: () => number }
function make846(): R846 { const r: R846 = { a846: 1 }; r.m846 = () => 1; return r; }
function c846(): void { say("stored-later/descriptor/strict-eq", (Object.getOwnPropertyDescriptor(make846(), "m846")!.value) === (Object.getOwnPropertyDescriptor(make846(), "m846")!.value)); }

interface R847 { a847: number; m847?: () => number }
function make847(): R847 { const r: R847 = { a847: 1 }; r.m847 = () => 1; return r; }
function c847(): void { say("stored-later/reflect-get/strict-eq", (Reflect.get(make847(), "m847")) === (Reflect.get(make847(), "m847"))); }

interface R848 { a848: number; m848?: () => number }
function make848(): R848 { const r: R848 = { a848: 1 }; r.m848 = () => 1; return r; }
function c848(): void { say("stored-later/spread/strict-eq", (({ ...make848() }).m848) === (({ ...make848() }).m848)); }

interface R849 { a849: number; m849?: () => number }
function make849(): R849 { const r: R849 = { a849: 1 }; r.m849 = () => 1; return r; }
function c849(): void { say("stored-later/assign/strict-eq", (Object.assign({}, make849()).m849) === (Object.assign({}, make849()).m849)); }

interface R850 { a850: number; m850?: () => number }
function make850(): R850 { const r: R850 = { a850: 1 }; r.m850 = () => 1; return r; }
function get850(): unknown { const { m850 } = make850(); return m850; }
function c850(): void { say("stored-later/pattern/strict-eq", (get850()) === (get850())); }

interface R851 { a851: number; m851?: () => number }
function make851(): R851 { const r: R851 = { a851: 1 }; r.m851 = () => 1; return r; }
function get851(): unknown { const { a851: _a, ...rest } = make851(); return rest.m851; }
function c851(): void { say("stored-later/rest-pattern/strict-eq", (get851()) === (get851())); }

interface R852 { a852: number; m852?: () => number }
function make852(): R852 { const r: R852 = { a852: 1 }; r.m852 = () => 1; return r; }
const key852: string = "m852";
function c852(): void { say("stored-later/computed-key/strict-eq", ((make852() as any)[key852]) === ((make852() as any)[key852])); }

interface R853 { a853: number; m853?: () => number }
function make853(): R853 { const r: R853 = { a853: 1 }; r.m853 = () => 1; return r; }
function get853(): unknown { const t = make853(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c853(): void { say("stored-later/for-in/strict-eq", (get853()) === (get853())); }

interface R854 { a854: number; m854?: () => number }
function make854(): R854 { const r: R854 = { a854: 1 }; r.m854 = () => 1; return r; }
function get854(): unknown { return make854().m854; }
function c854(): void { say("stored-later/getter/strict-ne", (get854()) !== (get854())); }

interface R855 { a855: number; m855?: () => number }
function make855(): R855 { const r: R855 = { a855: 1 }; r.m855 = () => 1; return r; }
function get855(): unknown { return make855().m855; }
function c855(): void { say("stored-later/getter/loose-eq", (get855()) == (get855())); }

interface R856 { a856: number; m856?: () => number }
function make856(): R856 { const r: R856 = { a856: 1 }; r.m856 = () => 1; return r; }
function get856(): unknown { return make856().m856; }
function c856(): void { say("stored-later/getter/object-is", Object.is((get856()), (get856()))); }

interface R857 { a857: number; m857?: () => number }
function make857(): R857 { const r: R857 = { a857: 1 }; r.m857 = () => 1; return r; }
function get857(): unknown { return make857().m857; }
function c857(): void { say("stored-later/getter/set", new Set([(get857()), (get857())]).size); }

interface R858 { a858: number; m858?: () => number }
function make858(): R858 { const r: R858 = { a858: 1 }; r.m858 = () => 1; return r; }
function get858(): unknown { return make858().m858; }
function c858(): void { say("stored-later/getter/map-key", new Map([[(get858()), 1], [(get858()), 2]]).size); }

interface R859 { a859: number; m859?: () => number }
function make859(): R859 { const r: R859 = { a859: 1 }; r.m859 = () => 1; return r; }
function get859(): unknown { return make859().m859; }
function c859(): void { say("stored-later/getter/includes", [(get859())].includes((get859()))); }

interface R860 { a860: number; m860?: () => number }
function make860(): R860 { const r: R860 = { a860: 1 }; r.m860 = () => 1; return r; }
function get860(): unknown { return make860().m860; }
function c860(): void { say("stored-later/getter/index-of", [(get860())].indexOf((get860()))); }

interface R861 { a861: number; m861?: () => number }
function make861(): R861 { const r: R861 = { a861: 1 }; r.m861 = () => 1; return r; }
function get861(): unknown { return make861().m861; }
const ws861 = new WeakSet<object>();
function c861(): void { say("stored-later/getter/weak-set", (ws861.add((get861()) as object), ws861.has((get861()) as object))); }

interface R862 { a862: number; m862?: () => number }
function make862(): R862 { const r: R862 = { a862: 1 }; r.m862 = () => 1; return r; }
function get862(): unknown { return make862().m862; }
const wm862 = new WeakMap<object, number>();
function c862(): void { say("stored-later/getter/weak-map", (wm862.set((get862()) as object, 1), wm862.has((get862()) as object))); }

interface R863 { a863: number; m863?: () => number }
function make863(): R863 { const r: R863 = { a863: 1 }; r.m863 = () => 1; return r; }
function get863(): unknown { return make863().m863; }
function c863(): void { say("stored-later/getter/written", ((((get863())) as any).tag = 1, (((get863())) as any).tag)); }

interface R864 { a864: number; m864?: () => number }
function make864(): R864 { const r: R864 = { a864: 1 }; r.m864 = () => 1; return r; }
function get864(): unknown { return make864().m864; }
function c864(): void { say("stored-later/getter/defined", (Object.defineProperty((get864()) as object, "t", { value: 1 }), "t" in ((get864()) as object))); }

interface R865 { a865: number; m865?: () => number }
function make865(): R865 { const r: R865 = { a865: 1 }; r.m865 = () => 1; return r; }
function get865(): unknown { return make865().m865; }
function c865(): void { say("stored-later/getter/frozen", (Object.freeze((get865())), Object.isFrozen((get865())))); }

interface R866 { a866: number; m866?: () => number }
function make866(): R866 { const r: R866 = { a866: 1 }; r.m866 = () => 1; return r; }
function get866(): unknown { return make866().m866; }
function c866(): void { say("stored-later/getter/prototype-set", (Object.setPrototypeOf((get866()) as object, null), Object.getPrototypeOf((get866())) === null)); }

interface R867 { a867: number; m867?: () => number }
function make867(): R867 { const r: R867 = { a867: 1 }; r.m867 = () => 1; return r; }
function get867(): unknown { return make867().m867; }
function c867(): void { say("stored-later/getter/deleted", (delete (((get867())) as any).length, Object.hasOwn((get867()) as object, "length"))); }

interface R868 { a868: number; m868?: () => number }
function make868(): R868 { const r: R868 = { a868: 1 }; r.m868 = () => 1; return r; }
function get868(): unknown { return make868().m868; }
function same868(a: unknown, b: unknown): boolean { return a === b; }
function c868(): void { say("stored-later/getter/in-a-callee", same868((get868()), (get868()))); }

interface R869 { a869: number; m869?: () => number }
function make869(): R869 { const r: R869 = { a869: 1 }; r.m869 = () => 1; return r; }
function get869(): unknown { return make869().m869; }
function hit869(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c869(): void { say("stored-later/getter/switch", hit869((get869()), (get869()))); }

interface R870 { a870: number; m870?: () => number }
function make870(): R870 { const r: R870 = { a870: 1 }; r.m870 = () => 1; return r; }
function get870(): unknown { return make870().m870; }
let last870: unknown;
function seen870(f: unknown): boolean { const same = f === last870; last870 = f; return same; }
function c870(): void { say("stored-later/getter/kept-then-compared", (seen870((get870())), seen870((get870())))); }

interface R871 { a871: number; m871: () => number }
function make871(): R871 { return { a871: 1, m871: function () { return 1; } }; }
function c871(): void { say("function-expression/inline/strict-eq", (make871().m871) === (make871().m871)); }

interface R872 { a872: number; m872: () => number }
function make872(): R872 { return { a872: 1, m872: function () { return 1; } }; }
function get872(): unknown { return make872().m872; }
function c872(): void { say("function-expression/getter/strict-eq", (get872()) === (get872())); }

interface R873 { a873: number; m873: () => number }
function make873(): R873 { return { a873: 1, m873: function () { return 1; } }; }
function get873a(): unknown { return make873().m873; }
function get873b(): unknown { return get873a(); }
function get873(): unknown { return get873b(); }
function c873(): void { say("function-expression/forwarded/strict-eq", (get873()) === (get873())); }

interface R874 { a874: number; m874: () => number }
function make874(): R874 { return { a874: 1, m874: function () { return 1; } }; }
function pick874(x: R874): unknown { return x.m874; }
function c874(): void { say("function-expression/picked/strict-eq", (pick874(make874())) === (pick874(make874()))); }

interface R875 { a875: number; m875: () => number }
function make875(): R875 { return { a875: 1, m875: function () { return 1; } }; }
function pick875(x: R875): unknown { return x.m875; }
function get875(): unknown { return pick875(make875()); }
function c875(): void { say("function-expression/picked-and-returned/strict-eq", (get875()) === (get875())); }

interface R876 { a876: number; m876: () => number }
function make876(): R876 { return { a876: 1, m876: function () { return 1; } }; }
let slot876: unknown;
function put876(): unknown { slot876 = make876().m876; return 0; }
function c876(): void { say("function-expression/variable/strict-eq", ((put876(), slot876)) === ((put876(), slot876))); }

interface R877 { a877: number; m877: () => number }
function make877(): R877 { return { a877: 1, m877: function () { return 1; } }; }
let kept877: R877 | undefined;
function keep877(): unknown { kept877 = make877(); return 0; }
function c877(): void { say("function-expression/holder-in-a-variable/strict-eq", ((keep877(), kept877!.m877)) === ((keep877(), kept877!.m877))); }

interface R878 { a878: number; m878: () => number }
function make878(): R878 { return { a878: 1, m878: function () { return 1; } }; }
function with878<T>(k: (f: unknown) => T): T { return k(make878().m878); }
function c878(): void { say("function-expression/callback/strict-eq", (with878(x => x)) === (with878(x => x))); }

interface R879 { a879: number; m879: () => number }
function make879(): R879 { return { a879: 1, m879: function () { return 1; } }; }
function later879(): () => unknown { const t = make879(); return () => t.m879; }
function c879(): void { say("function-expression/closure/strict-eq", (later879()()) === (later879()())); }

interface R880 { a880: number; m880: () => number }
function make880(): R880 { return { a880: 1, m880: function () { return 1; } }; }
function later880(): () => unknown { const f = make880().m880; return () => f; }
function c880(): void { say("function-expression/captured/strict-eq", (later880()()) === (later880()())); }

interface R881 { a881: number; m881: () => number }
function make881(): R881 { return { a881: 1, m881: function () { return 1; } }; }
function wrap881(): { f: unknown } { return { f: make881().m881 }; }
function c881(): void { say("function-expression/rewrapped/strict-eq", (wrap881().f) === (wrap881().f)); }

interface R882 { a882: number; m882: () => number }
function make882(): R882 { return { a882: 1, m882: function () { return 1; } }; }
function wrap882(): unknown[] { return [make882().m882]; }
function c882(): void { say("function-expression/rewrapped-in-an-array/strict-eq", (wrap882()[0]) === (wrap882()[0])); }

interface R883 { a883: number; m883: () => number }
function make883(): R883 { return { a883: 1, m883: function () { return 1; } }; }
function* gen883(): Generator<unknown> { yield make883().m883; }
function c883(): void { say("function-expression/generator/strict-eq", (gen883().next().value) === (gen883().next().value)); }

interface R884 { a884: number; m884: () => number }
function make884(): R884 { return { a884: 1, m884: function () { return 1; } }; }
class K884 { get(): unknown { return make884().m884; } }
function c884(): void { say("function-expression/method/strict-eq", (new K884().get()) === (new K884().get())); }

interface R885 { a885: number; m885: () => number }
function make885(): R885 { return { a885: 1, m885: function () { return 1; } }; }
class K885 { get f(): unknown { return make885().m885; } }
function c885(): void { say("function-expression/accessor/strict-eq", (new K885().f) === (new K885().f)); }

interface R886 { a886: number; m886: () => number }
function make886(): R886 { return { a886: 1, m886: function () { return 1; } }; }
function first886(...xs: unknown[]): unknown { return xs[0]; }
function c886(): void { say("function-expression/rest/strict-eq", (first886(make886().m886)) === (first886(make886().m886))); }

interface R887 { a887: number; m887: () => number }
function make887(): R887 { return { a887: 1, m887: function () { return 1; } }; }
function get887(): unknown { try { throw make887().m887; } catch (e) { return e; } }
function c887(): void { say("function-expression/thrown/strict-eq", (get887()) === (get887())); }

interface R888 { a888: number; m888: () => number }
function make888(): R888 { return { a888: 1, m888: function () { return 1; } }; }
function get888(other: unknown, which: boolean): unknown { return which ? make888().m888 : other; }
function c888(): void { say("function-expression/one-arm/strict-eq", (get888(0, true)) === (get888(0, true))); }

interface R889 { a889: number; m889: () => number }
function make889(): R889 { return { a889: 1, m889: function () { return 1; } }; }
function get889(): unknown { let t = make889(); for (let i = 0; i < 2; i++) t = make889(); return t.m889; }
function c889(): void { say("function-expression/loop/strict-eq", (get889()) === (get889())); }

interface R890 { a890: number; m890: () => number }
function make890(): R890 { return { a890: 1, m890: function () { return 1; } }; }
function id890<T>(x: T): T { return x; }
function get890(): unknown { return id890(make890()).m890; }
function c890(): void { say("function-expression/identity/strict-eq", (get890()) === (get890())); }

interface R891 { a891: number; m891: () => number }
function make891(): R891 { return { a891: 1, m891: function () { return 1; } }; }
function get891(): unknown { return make891().m891; }
const g891 = [get891];
function c891(): void { say("function-expression/by-value/strict-eq", (g891[0]()) === (g891[0]())); }

interface R892 { a892: number; m892: () => number }
function make892(): R892 { return { a892: 1, m892: function () { return 1; } }; }
function c892(): void { say("function-expression/values/strict-eq", (Object.values(make892())[1]) === (Object.values(make892())[1])); }

interface R893 { a893: number; m893: () => number }
function make893(): R893 { return { a893: 1, m893: function () { return 1; } }; }
function get893(): unknown { return Object.values(make893())[1]; }
function c893(): void { say("function-expression/values-returned/strict-eq", (get893()) === (get893())); }

interface R894 { a894: number; m894: () => number }
function make894(): R894 { return { a894: 1, m894: function () { return 1; } }; }
function c894(): void { say("function-expression/entries/strict-eq", (Object.entries(make894())[1][1]) === (Object.entries(make894())[1][1])); }

interface R895 { a895: number; m895: () => number }
function make895(): R895 { return { a895: 1, m895: function () { return 1; } }; }
function c895(): void { say("function-expression/descriptor/strict-eq", (Object.getOwnPropertyDescriptor(make895(), "m895")!.value) === (Object.getOwnPropertyDescriptor(make895(), "m895")!.value)); }

c836(); c837(); c838(); c839(); c840(); c841(); c842(); c843(); c844(); c845(); c846(); c847(); c848(); c849(); c850(); c851(); c852(); c853(); c854(); c855(); c856(); c857(); c858(); c859(); c860(); c861(); c862(); c863(); c864(); c865(); c866(); c867(); c868(); c869(); c870(); c871(); c872(); c873(); c874(); c875(); c876(); c877(); c878(); c879(); c880(); c881(); c882(); c883(); c884(); c885(); c886(); c887(); c888(); c889(); c890(); c891(); c892(); c893(); c894(); c895();
console.log(out.join("\n"));
