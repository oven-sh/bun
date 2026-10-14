// Generated program: object and closure identity stays observable when allocations are removed (second series, part 14).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R841 { a841: number; m841: () => number }
function make841(): R841 { return { a841: 1, m841: () => 1 }; }
function build841(f: () => R841): R841 { return f(); }
function get841(): unknown { return build841(make841).m841; }
function c841(): void { say("record/maker-as-a-callback-returned/frozen", (Object.freeze((get841())), Object.isFrozen((get841())))); }

interface R842 { a842: number; m842: () => number }
function make842(): R842 { return { a842: 1, m842: () => 1 }; }
function build842(f: () => R842): R842 { return f(); }
function get842(): unknown { return build842(make842).m842; }
function c842(): void { say("record/maker-as-a-callback-returned/prototype-set", (Object.setPrototypeOf((get842()) as object, null), Object.getPrototypeOf((get842())) === null)); }

interface R843 { a843: number; m843: () => number }
function make843(): R843 { return { a843: 1, m843: () => 1 }; }
function build843(f: () => R843): R843 { return f(); }
function get843(): unknown { return build843(make843).m843; }
function c843(): void { say("record/maker-as-a-callback-returned/deleted", (delete (((get843())) as any).length, Object.hasOwn((get843()) as object, "length"))); }

interface R844 { a844: number; m844: () => number }
function make844(): R844 { return { a844: 1, m844: () => 1 }; }
function build844(f: () => R844): R844 { return f(); }
function get844(): unknown { return build844(make844).m844; }
function same844(a: unknown, b: unknown): boolean { return a === b; }
function c844(): void { say("record/maker-as-a-callback-returned/in-a-callee", same844((get844()), (get844()))); }

interface R845 { a845: number; m845: () => number }
function make845(): R845 { return { a845: 1, m845: () => 1 }; }
function build845(f: () => R845): R845 { return f(); }
function get845(): unknown { return build845(make845).m845; }
function hit845(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c845(): void { say("record/maker-as-a-callback-returned/switch", hit845((get845()), (get845()))); }

interface R846 { a846: number; m846: () => number }
function make846(): R846 { return { a846: 1, m846: () => 1 }; }
function build846(f: () => R846): R846 { return f(); }
function get846(): unknown { return build846(make846).m846; }
let last846: unknown;
function seen846(f: unknown): boolean { const same = f === last846; last846 = f; return same; }
function c846(): void { say("record/maker-as-a-callback-returned/kept-then-compared", (seen846((get846())), seen846((get846())))); }

interface R847 { a847: number; m847: () => number }
function make847(): R847 { return { a847: 1, m847: () => 1 }; }
function box847(): { t: R847 } { return { t: make847() }; }
function get847(): unknown { return box847().t.m847; }
function c847(): void { say("record/holder-through-a-record/strict-eq", (get847()) === (get847())); }

interface R848 { a848: number; m848: () => number }
function make848(): R848 { return { a848: 1, m848: () => 1 }; }
function box848(): { t: R848 } { return { t: make848() }; }
function get848(): unknown { return box848().t.m848; }
function c848(): void { say("record/holder-through-a-record/strict-ne", (get848()) !== (get848())); }

interface R849 { a849: number; m849: () => number }
function make849(): R849 { return { a849: 1, m849: () => 1 }; }
function box849(): { t: R849 } { return { t: make849() }; }
function get849(): unknown { return box849().t.m849; }
function c849(): void { say("record/holder-through-a-record/loose-eq", (get849()) == (get849())); }

interface R850 { a850: number; m850: () => number }
function make850(): R850 { return { a850: 1, m850: () => 1 }; }
function box850(): { t: R850 } { return { t: make850() }; }
function get850(): unknown { return box850().t.m850; }
function c850(): void { say("record/holder-through-a-record/object-is", Object.is((get850()), (get850()))); }

interface R851 { a851: number; m851: () => number }
function make851(): R851 { return { a851: 1, m851: () => 1 }; }
function box851(): { t: R851 } { return { t: make851() }; }
function get851(): unknown { return box851().t.m851; }
function c851(): void { say("record/holder-through-a-record/set", new Set([(get851()), (get851())]).size); }

interface R852 { a852: number; m852: () => number }
function make852(): R852 { return { a852: 1, m852: () => 1 }; }
function box852(): { t: R852 } { return { t: make852() }; }
function get852(): unknown { return box852().t.m852; }
function c852(): void { say("record/holder-through-a-record/map-key", new Map([[(get852()), 1], [(get852()), 2]]).size); }

interface R853 { a853: number; m853: () => number }
function make853(): R853 { return { a853: 1, m853: () => 1 }; }
function box853(): { t: R853 } { return { t: make853() }; }
function get853(): unknown { return box853().t.m853; }
function c853(): void { say("record/holder-through-a-record/includes", [(get853())].includes((get853()))); }

interface R854 { a854: number; m854: () => number }
function make854(): R854 { return { a854: 1, m854: () => 1 }; }
function box854(): { t: R854 } { return { t: make854() }; }
function get854(): unknown { return box854().t.m854; }
function c854(): void { say("record/holder-through-a-record/index-of", [(get854())].indexOf((get854()))); }

interface R855 { a855: number; m855: () => number }
function make855(): R855 { return { a855: 1, m855: () => 1 }; }
function box855(): { t: R855 } { return { t: make855() }; }
function get855(): unknown { return box855().t.m855; }
const ws855 = new WeakSet<object>();
function c855(): void { say("record/holder-through-a-record/weak-set", (ws855.add((get855()) as object), ws855.has((get855()) as object))); }

interface R856 { a856: number; m856: () => number }
function make856(): R856 { return { a856: 1, m856: () => 1 }; }
function box856(): { t: R856 } { return { t: make856() }; }
function get856(): unknown { return box856().t.m856; }
const wm856 = new WeakMap<object, number>();
function c856(): void { say("record/holder-through-a-record/weak-map", (wm856.set((get856()) as object, 1), wm856.has((get856()) as object))); }

interface R857 { a857: number; m857: () => number }
function make857(): R857 { return { a857: 1, m857: () => 1 }; }
function box857(): { t: R857 } { return { t: make857() }; }
function get857(): unknown { return box857().t.m857; }
function c857(): void { say("record/holder-through-a-record/written", ((((get857())) as any).tag = 1, (((get857())) as any).tag)); }

interface R858 { a858: number; m858: () => number }
function make858(): R858 { return { a858: 1, m858: () => 1 }; }
function box858(): { t: R858 } { return { t: make858() }; }
function get858(): unknown { return box858().t.m858; }
function c858(): void { say("record/holder-through-a-record/defined", (Object.defineProperty((get858()) as object, "t", { value: 1 }), "t" in ((get858()) as object))); }

interface R859 { a859: number; m859: () => number }
function make859(): R859 { return { a859: 1, m859: () => 1 }; }
function box859(): { t: R859 } { return { t: make859() }; }
function get859(): unknown { return box859().t.m859; }
function c859(): void { say("record/holder-through-a-record/frozen", (Object.freeze((get859())), Object.isFrozen((get859())))); }

interface R860 { a860: number; m860: () => number }
function make860(): R860 { return { a860: 1, m860: () => 1 }; }
function box860(): { t: R860 } { return { t: make860() }; }
function get860(): unknown { return box860().t.m860; }
function c860(): void { say("record/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get860()) as object, null), Object.getPrototypeOf((get860())) === null)); }

interface R861 { a861: number; m861: () => number }
function make861(): R861 { return { a861: 1, m861: () => 1 }; }
function box861(): { t: R861 } { return { t: make861() }; }
function get861(): unknown { return box861().t.m861; }
function c861(): void { say("record/holder-through-a-record/deleted", (delete (((get861())) as any).length, Object.hasOwn((get861()) as object, "length"))); }

interface R862 { a862: number; m862: () => number }
function make862(): R862 { return { a862: 1, m862: () => 1 }; }
function box862(): { t: R862 } { return { t: make862() }; }
function get862(): unknown { return box862().t.m862; }
function same862(a: unknown, b: unknown): boolean { return a === b; }
function c862(): void { say("record/holder-through-a-record/in-a-callee", same862((get862()), (get862()))); }

interface R863 { a863: number; m863: () => number }
function make863(): R863 { return { a863: 1, m863: () => 1 }; }
function box863(): { t: R863 } { return { t: make863() }; }
function get863(): unknown { return box863().t.m863; }
function hit863(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c863(): void { say("record/holder-through-a-record/switch", hit863((get863()), (get863()))); }

interface R864 { a864: number; m864: () => number }
function make864(): R864 { return { a864: 1, m864: () => 1 }; }
function box864(): { t: R864 } { return { t: make864() }; }
function get864(): unknown { return box864().t.m864; }
let last864: unknown;
function seen864(f: unknown): boolean { const same = f === last864; last864 = f; return same; }
function c864(): void { say("record/holder-through-a-record/kept-then-compared", (seen864((get864())), seen864((get864())))); }

interface R865 { a865: number; m865: () => number }
function make865(): R865 { return { a865: 1, m865: () => 1 }; }
function box865(): Array<R865> { return [make865()]; }
function get865(): unknown { return box865()[0].m865; }
function c865(): void { say("record/holder-through-an-array/strict-eq", (get865()) === (get865())); }

interface R866 { a866: number; m866: () => number }
function make866(): R866 { return { a866: 1, m866: () => 1 }; }
function box866(): Array<R866> { return [make866()]; }
function get866(): unknown { return box866()[0].m866; }
function c866(): void { say("record/holder-through-an-array/strict-ne", (get866()) !== (get866())); }

interface R867 { a867: number; m867: () => number }
function make867(): R867 { return { a867: 1, m867: () => 1 }; }
function box867(): Array<R867> { return [make867()]; }
function get867(): unknown { return box867()[0].m867; }
function c867(): void { say("record/holder-through-an-array/loose-eq", (get867()) == (get867())); }

interface R868 { a868: number; m868: () => number }
function make868(): R868 { return { a868: 1, m868: () => 1 }; }
function box868(): Array<R868> { return [make868()]; }
function get868(): unknown { return box868()[0].m868; }
function c868(): void { say("record/holder-through-an-array/object-is", Object.is((get868()), (get868()))); }

interface R869 { a869: number; m869: () => number }
function make869(): R869 { return { a869: 1, m869: () => 1 }; }
function box869(): Array<R869> { return [make869()]; }
function get869(): unknown { return box869()[0].m869; }
function c869(): void { say("record/holder-through-an-array/set", new Set([(get869()), (get869())]).size); }

interface R870 { a870: number; m870: () => number }
function make870(): R870 { return { a870: 1, m870: () => 1 }; }
function box870(): Array<R870> { return [make870()]; }
function get870(): unknown { return box870()[0].m870; }
function c870(): void { say("record/holder-through-an-array/map-key", new Map([[(get870()), 1], [(get870()), 2]]).size); }

interface R871 { a871: number; m871: () => number }
function make871(): R871 { return { a871: 1, m871: () => 1 }; }
function box871(): Array<R871> { return [make871()]; }
function get871(): unknown { return box871()[0].m871; }
function c871(): void { say("record/holder-through-an-array/includes", [(get871())].includes((get871()))); }

interface R872 { a872: number; m872: () => number }
function make872(): R872 { return { a872: 1, m872: () => 1 }; }
function box872(): Array<R872> { return [make872()]; }
function get872(): unknown { return box872()[0].m872; }
function c872(): void { say("record/holder-through-an-array/index-of", [(get872())].indexOf((get872()))); }

interface R873 { a873: number; m873: () => number }
function make873(): R873 { return { a873: 1, m873: () => 1 }; }
function box873(): Array<R873> { return [make873()]; }
function get873(): unknown { return box873()[0].m873; }
const ws873 = new WeakSet<object>();
function c873(): void { say("record/holder-through-an-array/weak-set", (ws873.add((get873()) as object), ws873.has((get873()) as object))); }

interface R874 { a874: number; m874: () => number }
function make874(): R874 { return { a874: 1, m874: () => 1 }; }
function box874(): Array<R874> { return [make874()]; }
function get874(): unknown { return box874()[0].m874; }
const wm874 = new WeakMap<object, number>();
function c874(): void { say("record/holder-through-an-array/weak-map", (wm874.set((get874()) as object, 1), wm874.has((get874()) as object))); }

interface R875 { a875: number; m875: () => number }
function make875(): R875 { return { a875: 1, m875: () => 1 }; }
function box875(): Array<R875> { return [make875()]; }
function get875(): unknown { return box875()[0].m875; }
function c875(): void { say("record/holder-through-an-array/written", ((((get875())) as any).tag = 1, (((get875())) as any).tag)); }

interface R876 { a876: number; m876: () => number }
function make876(): R876 { return { a876: 1, m876: () => 1 }; }
function box876(): Array<R876> { return [make876()]; }
function get876(): unknown { return box876()[0].m876; }
function c876(): void { say("record/holder-through-an-array/defined", (Object.defineProperty((get876()) as object, "t", { value: 1 }), "t" in ((get876()) as object))); }

interface R877 { a877: number; m877: () => number }
function make877(): R877 { return { a877: 1, m877: () => 1 }; }
function box877(): Array<R877> { return [make877()]; }
function get877(): unknown { return box877()[0].m877; }
function c877(): void { say("record/holder-through-an-array/frozen", (Object.freeze((get877())), Object.isFrozen((get877())))); }

interface R878 { a878: number; m878: () => number }
function make878(): R878 { return { a878: 1, m878: () => 1 }; }
function box878(): Array<R878> { return [make878()]; }
function get878(): unknown { return box878()[0].m878; }
function c878(): void { say("record/holder-through-an-array/prototype-set", (Object.setPrototypeOf((get878()) as object, null), Object.getPrototypeOf((get878())) === null)); }

interface R879 { a879: number; m879: () => number }
function make879(): R879 { return { a879: 1, m879: () => 1 }; }
function box879(): Array<R879> { return [make879()]; }
function get879(): unknown { return box879()[0].m879; }
function c879(): void { say("record/holder-through-an-array/deleted", (delete (((get879())) as any).length, Object.hasOwn((get879()) as object, "length"))); }

interface R880 { a880: number; m880: () => number }
function make880(): R880 { return { a880: 1, m880: () => 1 }; }
function box880(): Array<R880> { return [make880()]; }
function get880(): unknown { return box880()[0].m880; }
function same880(a: unknown, b: unknown): boolean { return a === b; }
function c880(): void { say("record/holder-through-an-array/in-a-callee", same880((get880()), (get880()))); }

interface R881 { a881: number; m881: () => number }
function make881(): R881 { return { a881: 1, m881: () => 1 }; }
function box881(): Array<R881> { return [make881()]; }
function get881(): unknown { return box881()[0].m881; }
function hit881(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c881(): void { say("record/holder-through-an-array/switch", hit881((get881()), (get881()))); }

interface R882 { a882: number; m882: () => number }
function make882(): R882 { return { a882: 1, m882: () => 1 }; }
function box882(): Array<R882> { return [make882()]; }
function get882(): unknown { return box882()[0].m882; }
let last882: unknown;
function seen882(f: unknown): boolean { const same = f === last882; last882 = f; return same; }
function c882(): void { say("record/holder-through-an-array/kept-then-compared", (seen882((get882())), seen882((get882())))); }

interface R883 { a883: number; m883: () => number }
function make883(): R883 { return { a883: 1, m883: () => 1 }; }
function box883(): () => R883 { const t = make883(); return () => t; }
function get883(): unknown { return box883()().m883; }
function c883(): void { say("record/holder-through-a-closure/strict-eq", (get883()) === (get883())); }

interface R884 { a884: number; m884: () => number }
function make884(): R884 { return { a884: 1, m884: () => 1 }; }
function box884(): () => R884 { const t = make884(); return () => t; }
function get884(): unknown { return box884()().m884; }
function c884(): void { say("record/holder-through-a-closure/strict-ne", (get884()) !== (get884())); }

interface R885 { a885: number; m885: () => number }
function make885(): R885 { return { a885: 1, m885: () => 1 }; }
function box885(): () => R885 { const t = make885(); return () => t; }
function get885(): unknown { return box885()().m885; }
function c885(): void { say("record/holder-through-a-closure/loose-eq", (get885()) == (get885())); }

interface R886 { a886: number; m886: () => number }
function make886(): R886 { return { a886: 1, m886: () => 1 }; }
function box886(): () => R886 { const t = make886(); return () => t; }
function get886(): unknown { return box886()().m886; }
function c886(): void { say("record/holder-through-a-closure/object-is", Object.is((get886()), (get886()))); }

interface R887 { a887: number; m887: () => number }
function make887(): R887 { return { a887: 1, m887: () => 1 }; }
function box887(): () => R887 { const t = make887(); return () => t; }
function get887(): unknown { return box887()().m887; }
function c887(): void { say("record/holder-through-a-closure/set", new Set([(get887()), (get887())]).size); }

interface R888 { a888: number; m888: () => number }
function make888(): R888 { return { a888: 1, m888: () => 1 }; }
function box888(): () => R888 { const t = make888(); return () => t; }
function get888(): unknown { return box888()().m888; }
function c888(): void { say("record/holder-through-a-closure/map-key", new Map([[(get888()), 1], [(get888()), 2]]).size); }

interface R889 { a889: number; m889: () => number }
function make889(): R889 { return { a889: 1, m889: () => 1 }; }
function box889(): () => R889 { const t = make889(); return () => t; }
function get889(): unknown { return box889()().m889; }
function c889(): void { say("record/holder-through-a-closure/includes", [(get889())].includes((get889()))); }

interface R890 { a890: number; m890: () => number }
function make890(): R890 { return { a890: 1, m890: () => 1 }; }
function box890(): () => R890 { const t = make890(); return () => t; }
function get890(): unknown { return box890()().m890; }
function c890(): void { say("record/holder-through-a-closure/index-of", [(get890())].indexOf((get890()))); }

interface R891 { a891: number; m891: () => number }
function make891(): R891 { return { a891: 1, m891: () => 1 }; }
function box891(): () => R891 { const t = make891(); return () => t; }
function get891(): unknown { return box891()().m891; }
const ws891 = new WeakSet<object>();
function c891(): void { say("record/holder-through-a-closure/weak-set", (ws891.add((get891()) as object), ws891.has((get891()) as object))); }

interface R892 { a892: number; m892: () => number }
function make892(): R892 { return { a892: 1, m892: () => 1 }; }
function box892(): () => R892 { const t = make892(); return () => t; }
function get892(): unknown { return box892()().m892; }
const wm892 = new WeakMap<object, number>();
function c892(): void { say("record/holder-through-a-closure/weak-map", (wm892.set((get892()) as object, 1), wm892.has((get892()) as object))); }

interface R893 { a893: number; m893: () => number }
function make893(): R893 { return { a893: 1, m893: () => 1 }; }
function box893(): () => R893 { const t = make893(); return () => t; }
function get893(): unknown { return box893()().m893; }
function c893(): void { say("record/holder-through-a-closure/written", ((((get893())) as any).tag = 1, (((get893())) as any).tag)); }

interface R894 { a894: number; m894: () => number }
function make894(): R894 { return { a894: 1, m894: () => 1 }; }
function box894(): () => R894 { const t = make894(); return () => t; }
function get894(): unknown { return box894()().m894; }
function c894(): void { say("record/holder-through-a-closure/defined", (Object.defineProperty((get894()) as object, "t", { value: 1 }), "t" in ((get894()) as object))); }

interface R895 { a895: number; m895: () => number }
function make895(): R895 { return { a895: 1, m895: () => 1 }; }
function box895(): () => R895 { const t = make895(); return () => t; }
function get895(): unknown { return box895()().m895; }
function c895(): void { say("record/holder-through-a-closure/frozen", (Object.freeze((get895())), Object.isFrozen((get895())))); }

interface R896 { a896: number; m896: () => number }
function make896(): R896 { return { a896: 1, m896: () => 1 }; }
function box896(): () => R896 { const t = make896(); return () => t; }
function get896(): unknown { return box896()().m896; }
function c896(): void { say("record/holder-through-a-closure/prototype-set", (Object.setPrototypeOf((get896()) as object, null), Object.getPrototypeOf((get896())) === null)); }

interface R897 { a897: number; m897: () => number }
function make897(): R897 { return { a897: 1, m897: () => 1 }; }
function box897(): () => R897 { const t = make897(); return () => t; }
function get897(): unknown { return box897()().m897; }
function c897(): void { say("record/holder-through-a-closure/deleted", (delete (((get897())) as any).length, Object.hasOwn((get897()) as object, "length"))); }

interface R898 { a898: number; m898: () => number }
function make898(): R898 { return { a898: 1, m898: () => 1 }; }
function box898(): () => R898 { const t = make898(); return () => t; }
function get898(): unknown { return box898()().m898; }
function same898(a: unknown, b: unknown): boolean { return a === b; }
function c898(): void { say("record/holder-through-a-closure/in-a-callee", same898((get898()), (get898()))); }

interface R899 { a899: number; m899: () => number }
function make899(): R899 { return { a899: 1, m899: () => 1 }; }
function box899(): () => R899 { const t = make899(); return () => t; }
function get899(): unknown { return box899()().m899; }
function hit899(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c899(): void { say("record/holder-through-a-closure/switch", hit899((get899()), (get899()))); }

interface R900 { a900: number; m900: () => number }
function make900(): R900 { return { a900: 1, m900: () => 1 }; }
function box900(): () => R900 { const t = make900(); return () => t; }
function get900(): unknown { return box900()().m900; }
let last900: unknown;
function seen900(f: unknown): boolean { const same = f === last900; last900 = f; return same; }
function c900(): void { say("record/holder-through-a-closure/kept-then-compared", (seen900((get900())), seen900((get900())))); }

c841(); c842(); c843(); c844(); c845(); c846(); c847(); c848(); c849(); c850(); c851(); c852(); c853(); c854(); c855(); c856(); c857(); c858(); c859(); c860(); c861(); c862(); c863(); c864(); c865(); c866(); c867(); c868(); c869(); c870(); c871(); c872(); c873(); c874(); c875(); c876(); c877(); c878(); c879(); c880(); c881(); c882(); c883(); c884(); c885(); c886(); c887(); c888(); c889(); c890(); c891(); c892(); c893(); c894(); c895(); c896(); c897(); c898(); c899(); c900();
console.log(out.join("\n"));
