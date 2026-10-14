// Generated program: object and closure identity stays observable when allocations are removed (second series, part 13).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R781 { a781: number; m781: () => number }
function make781(): R781 { return { a781: 1, m781: () => 1 }; }
function again781(): R781 { return make781(); }
function c781(): void { say("record/maker-forwarded/includes", [(again781().m781)].includes((again781().m781))); }

interface R782 { a782: number; m782: () => number }
function make782(): R782 { return { a782: 1, m782: () => 1 }; }
function again782(): R782 { return make782(); }
function c782(): void { say("record/maker-forwarded/index-of", [(again782().m782)].indexOf((again782().m782))); }

interface R783 { a783: number; m783: () => number }
function make783(): R783 { return { a783: 1, m783: () => 1 }; }
function again783(): R783 { return make783(); }
const ws783 = new WeakSet<object>();
function c783(): void { say("record/maker-forwarded/weak-set", (ws783.add((again783().m783) as object), ws783.has((again783().m783) as object))); }

interface R784 { a784: number; m784: () => number }
function make784(): R784 { return { a784: 1, m784: () => 1 }; }
function again784(): R784 { return make784(); }
const wm784 = new WeakMap<object, number>();
function c784(): void { say("record/maker-forwarded/weak-map", (wm784.set((again784().m784) as object, 1), wm784.has((again784().m784) as object))); }

interface R785 { a785: number; m785: () => number }
function make785(): R785 { return { a785: 1, m785: () => 1 }; }
function again785(): R785 { return make785(); }
function c785(): void { say("record/maker-forwarded/written", ((((again785().m785)) as any).tag = 1, (((again785().m785)) as any).tag)); }

interface R786 { a786: number; m786: () => number }
function make786(): R786 { return { a786: 1, m786: () => 1 }; }
function again786(): R786 { return make786(); }
function c786(): void { say("record/maker-forwarded/defined", (Object.defineProperty((again786().m786) as object, "t", { value: 1 }), "t" in ((again786().m786) as object))); }

interface R787 { a787: number; m787: () => number }
function make787(): R787 { return { a787: 1, m787: () => 1 }; }
function again787(): R787 { return make787(); }
function c787(): void { say("record/maker-forwarded/frozen", (Object.freeze((again787().m787)), Object.isFrozen((again787().m787)))); }

interface R788 { a788: number; m788: () => number }
function make788(): R788 { return { a788: 1, m788: () => 1 }; }
function again788(): R788 { return make788(); }
function c788(): void { say("record/maker-forwarded/prototype-set", (Object.setPrototypeOf((again788().m788) as object, null), Object.getPrototypeOf((again788().m788)) === null)); }

interface R789 { a789: number; m789: () => number }
function make789(): R789 { return { a789: 1, m789: () => 1 }; }
function again789(): R789 { return make789(); }
function c789(): void { say("record/maker-forwarded/deleted", (delete (((again789().m789)) as any).length, Object.hasOwn((again789().m789) as object, "length"))); }

interface R790 { a790: number; m790: () => number }
function make790(): R790 { return { a790: 1, m790: () => 1 }; }
function again790(): R790 { return make790(); }
function same790(a: unknown, b: unknown): boolean { return a === b; }
function c790(): void { say("record/maker-forwarded/in-a-callee", same790((again790().m790), (again790().m790))); }

interface R791 { a791: number; m791: () => number }
function make791(): R791 { return { a791: 1, m791: () => 1 }; }
function again791(): R791 { return make791(); }
function hit791(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c791(): void { say("record/maker-forwarded/switch", hit791((again791().m791), (again791().m791))); }

interface R792 { a792: number; m792: () => number }
function make792(): R792 { return { a792: 1, m792: () => 1 }; }
function again792(): R792 { return make792(); }
let last792: unknown;
function seen792(f: unknown): boolean { const same = f === last792; last792 = f; return same; }
function c792(): void { say("record/maker-forwarded/kept-then-compared", (seen792((again792().m792)), seen792((again792().m792)))); }

interface R793 { a793: number; m793: () => number }
function make793(): R793 { return { a793: 1, m793: () => 1 }; }
function again793(): R793 { return make793(); }
function get793(): unknown { return again793().m793; }
function c793(): void { say("record/maker-forwarded-and-returned/strict-eq", (get793()) === (get793())); }

interface R794 { a794: number; m794: () => number }
function make794(): R794 { return { a794: 1, m794: () => 1 }; }
function again794(): R794 { return make794(); }
function get794(): unknown { return again794().m794; }
function c794(): void { say("record/maker-forwarded-and-returned/strict-ne", (get794()) !== (get794())); }

interface R795 { a795: number; m795: () => number }
function make795(): R795 { return { a795: 1, m795: () => 1 }; }
function again795(): R795 { return make795(); }
function get795(): unknown { return again795().m795; }
function c795(): void { say("record/maker-forwarded-and-returned/loose-eq", (get795()) == (get795())); }

interface R796 { a796: number; m796: () => number }
function make796(): R796 { return { a796: 1, m796: () => 1 }; }
function again796(): R796 { return make796(); }
function get796(): unknown { return again796().m796; }
function c796(): void { say("record/maker-forwarded-and-returned/object-is", Object.is((get796()), (get796()))); }

interface R797 { a797: number; m797: () => number }
function make797(): R797 { return { a797: 1, m797: () => 1 }; }
function again797(): R797 { return make797(); }
function get797(): unknown { return again797().m797; }
function c797(): void { say("record/maker-forwarded-and-returned/set", new Set([(get797()), (get797())]).size); }

interface R798 { a798: number; m798: () => number }
function make798(): R798 { return { a798: 1, m798: () => 1 }; }
function again798(): R798 { return make798(); }
function get798(): unknown { return again798().m798; }
function c798(): void { say("record/maker-forwarded-and-returned/map-key", new Map([[(get798()), 1], [(get798()), 2]]).size); }

interface R799 { a799: number; m799: () => number }
function make799(): R799 { return { a799: 1, m799: () => 1 }; }
function again799(): R799 { return make799(); }
function get799(): unknown { return again799().m799; }
function c799(): void { say("record/maker-forwarded-and-returned/includes", [(get799())].includes((get799()))); }

interface R800 { a800: number; m800: () => number }
function make800(): R800 { return { a800: 1, m800: () => 1 }; }
function again800(): R800 { return make800(); }
function get800(): unknown { return again800().m800; }
function c800(): void { say("record/maker-forwarded-and-returned/index-of", [(get800())].indexOf((get800()))); }

interface R801 { a801: number; m801: () => number }
function make801(): R801 { return { a801: 1, m801: () => 1 }; }
function again801(): R801 { return make801(); }
function get801(): unknown { return again801().m801; }
const ws801 = new WeakSet<object>();
function c801(): void { say("record/maker-forwarded-and-returned/weak-set", (ws801.add((get801()) as object), ws801.has((get801()) as object))); }

interface R802 { a802: number; m802: () => number }
function make802(): R802 { return { a802: 1, m802: () => 1 }; }
function again802(): R802 { return make802(); }
function get802(): unknown { return again802().m802; }
const wm802 = new WeakMap<object, number>();
function c802(): void { say("record/maker-forwarded-and-returned/weak-map", (wm802.set((get802()) as object, 1), wm802.has((get802()) as object))); }

interface R803 { a803: number; m803: () => number }
function make803(): R803 { return { a803: 1, m803: () => 1 }; }
function again803(): R803 { return make803(); }
function get803(): unknown { return again803().m803; }
function c803(): void { say("record/maker-forwarded-and-returned/written", ((((get803())) as any).tag = 1, (((get803())) as any).tag)); }

interface R804 { a804: number; m804: () => number }
function make804(): R804 { return { a804: 1, m804: () => 1 }; }
function again804(): R804 { return make804(); }
function get804(): unknown { return again804().m804; }
function c804(): void { say("record/maker-forwarded-and-returned/defined", (Object.defineProperty((get804()) as object, "t", { value: 1 }), "t" in ((get804()) as object))); }

interface R805 { a805: number; m805: () => number }
function make805(): R805 { return { a805: 1, m805: () => 1 }; }
function again805(): R805 { return make805(); }
function get805(): unknown { return again805().m805; }
function c805(): void { say("record/maker-forwarded-and-returned/frozen", (Object.freeze((get805())), Object.isFrozen((get805())))); }

interface R806 { a806: number; m806: () => number }
function make806(): R806 { return { a806: 1, m806: () => 1 }; }
function again806(): R806 { return make806(); }
function get806(): unknown { return again806().m806; }
function c806(): void { say("record/maker-forwarded-and-returned/prototype-set", (Object.setPrototypeOf((get806()) as object, null), Object.getPrototypeOf((get806())) === null)); }

interface R807 { a807: number; m807: () => number }
function make807(): R807 { return { a807: 1, m807: () => 1 }; }
function again807(): R807 { return make807(); }
function get807(): unknown { return again807().m807; }
function c807(): void { say("record/maker-forwarded-and-returned/deleted", (delete (((get807())) as any).length, Object.hasOwn((get807()) as object, "length"))); }

interface R808 { a808: number; m808: () => number }
function make808(): R808 { return { a808: 1, m808: () => 1 }; }
function again808(): R808 { return make808(); }
function get808(): unknown { return again808().m808; }
function same808(a: unknown, b: unknown): boolean { return a === b; }
function c808(): void { say("record/maker-forwarded-and-returned/in-a-callee", same808((get808()), (get808()))); }

interface R809 { a809: number; m809: () => number }
function make809(): R809 { return { a809: 1, m809: () => 1 }; }
function again809(): R809 { return make809(); }
function get809(): unknown { return again809().m809; }
function hit809(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c809(): void { say("record/maker-forwarded-and-returned/switch", hit809((get809()), (get809()))); }

interface R810 { a810: number; m810: () => number }
function make810(): R810 { return { a810: 1, m810: () => 1 }; }
function again810(): R810 { return make810(); }
function get810(): unknown { return again810().m810; }
let last810: unknown;
function seen810(f: unknown): boolean { const same = f === last810; last810 = f; return same; }
function c810(): void { say("record/maker-forwarded-and-returned/kept-then-compared", (seen810((get810())), seen810((get810())))); }

interface R811 { a811: number; m811: () => number }
function make811(): R811 { return { a811: 1, m811: () => 1 }; }
function build811(f: () => R811): R811 { return f(); }
function c811(): void { say("record/maker-as-a-callback/strict-eq", (build811(make811).m811) === (build811(make811).m811)); }

interface R812 { a812: number; m812: () => number }
function make812(): R812 { return { a812: 1, m812: () => 1 }; }
function build812(f: () => R812): R812 { return f(); }
function c812(): void { say("record/maker-as-a-callback/strict-ne", (build812(make812).m812) !== (build812(make812).m812)); }

interface R813 { a813: number; m813: () => number }
function make813(): R813 { return { a813: 1, m813: () => 1 }; }
function build813(f: () => R813): R813 { return f(); }
function c813(): void { say("record/maker-as-a-callback/loose-eq", (build813(make813).m813) == (build813(make813).m813)); }

interface R814 { a814: number; m814: () => number }
function make814(): R814 { return { a814: 1, m814: () => 1 }; }
function build814(f: () => R814): R814 { return f(); }
function c814(): void { say("record/maker-as-a-callback/object-is", Object.is((build814(make814).m814), (build814(make814).m814))); }

interface R815 { a815: number; m815: () => number }
function make815(): R815 { return { a815: 1, m815: () => 1 }; }
function build815(f: () => R815): R815 { return f(); }
function c815(): void { say("record/maker-as-a-callback/set", new Set([(build815(make815).m815), (build815(make815).m815)]).size); }

interface R816 { a816: number; m816: () => number }
function make816(): R816 { return { a816: 1, m816: () => 1 }; }
function build816(f: () => R816): R816 { return f(); }
function c816(): void { say("record/maker-as-a-callback/map-key", new Map([[(build816(make816).m816), 1], [(build816(make816).m816), 2]]).size); }

interface R817 { a817: number; m817: () => number }
function make817(): R817 { return { a817: 1, m817: () => 1 }; }
function build817(f: () => R817): R817 { return f(); }
function c817(): void { say("record/maker-as-a-callback/includes", [(build817(make817).m817)].includes((build817(make817).m817))); }

interface R818 { a818: number; m818: () => number }
function make818(): R818 { return { a818: 1, m818: () => 1 }; }
function build818(f: () => R818): R818 { return f(); }
function c818(): void { say("record/maker-as-a-callback/index-of", [(build818(make818).m818)].indexOf((build818(make818).m818))); }

interface R819 { a819: number; m819: () => number }
function make819(): R819 { return { a819: 1, m819: () => 1 }; }
function build819(f: () => R819): R819 { return f(); }
const ws819 = new WeakSet<object>();
function c819(): void { say("record/maker-as-a-callback/weak-set", (ws819.add((build819(make819).m819) as object), ws819.has((build819(make819).m819) as object))); }

interface R820 { a820: number; m820: () => number }
function make820(): R820 { return { a820: 1, m820: () => 1 }; }
function build820(f: () => R820): R820 { return f(); }
const wm820 = new WeakMap<object, number>();
function c820(): void { say("record/maker-as-a-callback/weak-map", (wm820.set((build820(make820).m820) as object, 1), wm820.has((build820(make820).m820) as object))); }

interface R821 { a821: number; m821: () => number }
function make821(): R821 { return { a821: 1, m821: () => 1 }; }
function build821(f: () => R821): R821 { return f(); }
function c821(): void { say("record/maker-as-a-callback/written", ((((build821(make821).m821)) as any).tag = 1, (((build821(make821).m821)) as any).tag)); }

interface R822 { a822: number; m822: () => number }
function make822(): R822 { return { a822: 1, m822: () => 1 }; }
function build822(f: () => R822): R822 { return f(); }
function c822(): void { say("record/maker-as-a-callback/defined", (Object.defineProperty((build822(make822).m822) as object, "t", { value: 1 }), "t" in ((build822(make822).m822) as object))); }

interface R823 { a823: number; m823: () => number }
function make823(): R823 { return { a823: 1, m823: () => 1 }; }
function build823(f: () => R823): R823 { return f(); }
function c823(): void { say("record/maker-as-a-callback/frozen", (Object.freeze((build823(make823).m823)), Object.isFrozen((build823(make823).m823)))); }

interface R824 { a824: number; m824: () => number }
function make824(): R824 { return { a824: 1, m824: () => 1 }; }
function build824(f: () => R824): R824 { return f(); }
function c824(): void { say("record/maker-as-a-callback/prototype-set", (Object.setPrototypeOf((build824(make824).m824) as object, null), Object.getPrototypeOf((build824(make824).m824)) === null)); }

interface R825 { a825: number; m825: () => number }
function make825(): R825 { return { a825: 1, m825: () => 1 }; }
function build825(f: () => R825): R825 { return f(); }
function c825(): void { say("record/maker-as-a-callback/deleted", (delete (((build825(make825).m825)) as any).length, Object.hasOwn((build825(make825).m825) as object, "length"))); }

interface R826 { a826: number; m826: () => number }
function make826(): R826 { return { a826: 1, m826: () => 1 }; }
function build826(f: () => R826): R826 { return f(); }
function same826(a: unknown, b: unknown): boolean { return a === b; }
function c826(): void { say("record/maker-as-a-callback/in-a-callee", same826((build826(make826).m826), (build826(make826).m826))); }

interface R827 { a827: number; m827: () => number }
function make827(): R827 { return { a827: 1, m827: () => 1 }; }
function build827(f: () => R827): R827 { return f(); }
function hit827(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c827(): void { say("record/maker-as-a-callback/switch", hit827((build827(make827).m827), (build827(make827).m827))); }

interface R828 { a828: number; m828: () => number }
function make828(): R828 { return { a828: 1, m828: () => 1 }; }
function build828(f: () => R828): R828 { return f(); }
let last828: unknown;
function seen828(f: unknown): boolean { const same = f === last828; last828 = f; return same; }
function c828(): void { say("record/maker-as-a-callback/kept-then-compared", (seen828((build828(make828).m828)), seen828((build828(make828).m828)))); }

interface R829 { a829: number; m829: () => number }
function make829(): R829 { return { a829: 1, m829: () => 1 }; }
function build829(f: () => R829): R829 { return f(); }
function get829(): unknown { return build829(make829).m829; }
function c829(): void { say("record/maker-as-a-callback-returned/strict-eq", (get829()) === (get829())); }

interface R830 { a830: number; m830: () => number }
function make830(): R830 { return { a830: 1, m830: () => 1 }; }
function build830(f: () => R830): R830 { return f(); }
function get830(): unknown { return build830(make830).m830; }
function c830(): void { say("record/maker-as-a-callback-returned/strict-ne", (get830()) !== (get830())); }

interface R831 { a831: number; m831: () => number }
function make831(): R831 { return { a831: 1, m831: () => 1 }; }
function build831(f: () => R831): R831 { return f(); }
function get831(): unknown { return build831(make831).m831; }
function c831(): void { say("record/maker-as-a-callback-returned/loose-eq", (get831()) == (get831())); }

interface R832 { a832: number; m832: () => number }
function make832(): R832 { return { a832: 1, m832: () => 1 }; }
function build832(f: () => R832): R832 { return f(); }
function get832(): unknown { return build832(make832).m832; }
function c832(): void { say("record/maker-as-a-callback-returned/object-is", Object.is((get832()), (get832()))); }

interface R833 { a833: number; m833: () => number }
function make833(): R833 { return { a833: 1, m833: () => 1 }; }
function build833(f: () => R833): R833 { return f(); }
function get833(): unknown { return build833(make833).m833; }
function c833(): void { say("record/maker-as-a-callback-returned/set", new Set([(get833()), (get833())]).size); }

interface R834 { a834: number; m834: () => number }
function make834(): R834 { return { a834: 1, m834: () => 1 }; }
function build834(f: () => R834): R834 { return f(); }
function get834(): unknown { return build834(make834).m834; }
function c834(): void { say("record/maker-as-a-callback-returned/map-key", new Map([[(get834()), 1], [(get834()), 2]]).size); }

interface R835 { a835: number; m835: () => number }
function make835(): R835 { return { a835: 1, m835: () => 1 }; }
function build835(f: () => R835): R835 { return f(); }
function get835(): unknown { return build835(make835).m835; }
function c835(): void { say("record/maker-as-a-callback-returned/includes", [(get835())].includes((get835()))); }

interface R836 { a836: number; m836: () => number }
function make836(): R836 { return { a836: 1, m836: () => 1 }; }
function build836(f: () => R836): R836 { return f(); }
function get836(): unknown { return build836(make836).m836; }
function c836(): void { say("record/maker-as-a-callback-returned/index-of", [(get836())].indexOf((get836()))); }

interface R837 { a837: number; m837: () => number }
function make837(): R837 { return { a837: 1, m837: () => 1 }; }
function build837(f: () => R837): R837 { return f(); }
function get837(): unknown { return build837(make837).m837; }
const ws837 = new WeakSet<object>();
function c837(): void { say("record/maker-as-a-callback-returned/weak-set", (ws837.add((get837()) as object), ws837.has((get837()) as object))); }

interface R838 { a838: number; m838: () => number }
function make838(): R838 { return { a838: 1, m838: () => 1 }; }
function build838(f: () => R838): R838 { return f(); }
function get838(): unknown { return build838(make838).m838; }
const wm838 = new WeakMap<object, number>();
function c838(): void { say("record/maker-as-a-callback-returned/weak-map", (wm838.set((get838()) as object, 1), wm838.has((get838()) as object))); }

interface R839 { a839: number; m839: () => number }
function make839(): R839 { return { a839: 1, m839: () => 1 }; }
function build839(f: () => R839): R839 { return f(); }
function get839(): unknown { return build839(make839).m839; }
function c839(): void { say("record/maker-as-a-callback-returned/written", ((((get839())) as any).tag = 1, (((get839())) as any).tag)); }

interface R840 { a840: number; m840: () => number }
function make840(): R840 { return { a840: 1, m840: () => 1 }; }
function build840(f: () => R840): R840 { return f(); }
function get840(): unknown { return build840(make840).m840; }
function c840(): void { say("record/maker-as-a-callback-returned/defined", (Object.defineProperty((get840()) as object, "t", { value: 1 }), "t" in ((get840()) as object))); }

c781(); c782(); c783(); c784(); c785(); c786(); c787(); c788(); c789(); c790(); c791(); c792(); c793(); c794(); c795(); c796(); c797(); c798(); c799(); c800(); c801(); c802(); c803(); c804(); c805(); c806(); c807(); c808(); c809(); c810(); c811(); c812(); c813(); c814(); c815(); c816(); c817(); c818(); c819(); c820(); c821(); c822(); c823(); c824(); c825(); c826(); c827(); c828(); c829(); c830(); c831(); c832(); c833(); c834(); c835(); c836(); c837(); c838(); c839(); c840();
console.log(out.join("\n"));
