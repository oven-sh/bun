// Generated program: object and closure identity stays observable when allocations are removed (second series, part 11).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R661 { a661: number; m661: () => number }
function make661(): R661 { return { a661: 1, m661: () => 1 }; }
function c661(): void { say("record/getter-member/frozen", (Object.freeze((({ get f(): unknown { return make661().m661; } }).f)), Object.isFrozen((({ get f(): unknown { return make661().m661; } }).f)))); }

interface R662 { a662: number; m662: () => number }
function make662(): R662 { return { a662: 1, m662: () => 1 }; }
function c662(): void { say("record/getter-member/prototype-set", (Object.setPrototypeOf((({ get f(): unknown { return make662().m662; } }).f) as object, null), Object.getPrototypeOf((({ get f(): unknown { return make662().m662; } }).f)) === null)); }

interface R663 { a663: number; m663: () => number }
function make663(): R663 { return { a663: 1, m663: () => 1 }; }
function c663(): void { say("record/getter-member/deleted", (delete (((({ get f(): unknown { return make663().m663; } }).f)) as any).length, Object.hasOwn((({ get f(): unknown { return make663().m663; } }).f) as object, "length"))); }

interface R664 { a664: number; m664: () => number }
function make664(): R664 { return { a664: 1, m664: () => 1 }; }
function same664(a: unknown, b: unknown): boolean { return a === b; }
function c664(): void { say("record/getter-member/in-a-callee", same664((({ get f(): unknown { return make664().m664; } }).f), (({ get f(): unknown { return make664().m664; } }).f))); }

interface R665 { a665: number; m665: () => number }
function make665(): R665 { return { a665: 1, m665: () => 1 }; }
function hit665(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c665(): void { say("record/getter-member/switch", hit665((({ get f(): unknown { return make665().m665; } }).f), (({ get f(): unknown { return make665().m665; } }).f))); }

interface R666 { a666: number; m666: () => number }
function make666(): R666 { return { a666: 1, m666: () => 1 }; }
let last666: unknown;
function seen666(f: unknown): boolean { const same = f === last666; last666 = f; return same; }
function c666(): void { say("record/getter-member/kept-then-compared", (seen666((({ get f(): unknown { return make666().m666; } }).f)), seen666((({ get f(): unknown { return make666().m666; } }).f)))); }

interface R667 { a667: number; m667: () => number }
function make667(): R667 { return { a667: 1, m667: () => 1 }; }
function c667(): void { say("record/proxy-get/strict-eq", (new Proxy({ f: make667().m667 as unknown }, {}).f) === (new Proxy({ f: make667().m667 as unknown }, {}).f)); }

interface R668 { a668: number; m668: () => number }
function make668(): R668 { return { a668: 1, m668: () => 1 }; }
function c668(): void { say("record/proxy-get/strict-ne", (new Proxy({ f: make668().m668 as unknown }, {}).f) !== (new Proxy({ f: make668().m668 as unknown }, {}).f)); }

interface R669 { a669: number; m669: () => number }
function make669(): R669 { return { a669: 1, m669: () => 1 }; }
function c669(): void { say("record/proxy-get/loose-eq", (new Proxy({ f: make669().m669 as unknown }, {}).f) == (new Proxy({ f: make669().m669 as unknown }, {}).f)); }

interface R670 { a670: number; m670: () => number }
function make670(): R670 { return { a670: 1, m670: () => 1 }; }
function c670(): void { say("record/proxy-get/object-is", Object.is((new Proxy({ f: make670().m670 as unknown }, {}).f), (new Proxy({ f: make670().m670 as unknown }, {}).f))); }

interface R671 { a671: number; m671: () => number }
function make671(): R671 { return { a671: 1, m671: () => 1 }; }
function c671(): void { say("record/proxy-get/set", new Set([(new Proxy({ f: make671().m671 as unknown }, {}).f), (new Proxy({ f: make671().m671 as unknown }, {}).f)]).size); }

interface R672 { a672: number; m672: () => number }
function make672(): R672 { return { a672: 1, m672: () => 1 }; }
function c672(): void { say("record/proxy-get/map-key", new Map([[(new Proxy({ f: make672().m672 as unknown }, {}).f), 1], [(new Proxy({ f: make672().m672 as unknown }, {}).f), 2]]).size); }

interface R673 { a673: number; m673: () => number }
function make673(): R673 { return { a673: 1, m673: () => 1 }; }
function c673(): void { say("record/proxy-get/includes", [(new Proxy({ f: make673().m673 as unknown }, {}).f)].includes((new Proxy({ f: make673().m673 as unknown }, {}).f))); }

interface R674 { a674: number; m674: () => number }
function make674(): R674 { return { a674: 1, m674: () => 1 }; }
function c674(): void { say("record/proxy-get/index-of", [(new Proxy({ f: make674().m674 as unknown }, {}).f)].indexOf((new Proxy({ f: make674().m674 as unknown }, {}).f))); }

interface R675 { a675: number; m675: () => number }
function make675(): R675 { return { a675: 1, m675: () => 1 }; }
const ws675 = new WeakSet<object>();
function c675(): void { say("record/proxy-get/weak-set", (ws675.add((new Proxy({ f: make675().m675 as unknown }, {}).f) as object), ws675.has((new Proxy({ f: make675().m675 as unknown }, {}).f) as object))); }

interface R676 { a676: number; m676: () => number }
function make676(): R676 { return { a676: 1, m676: () => 1 }; }
const wm676 = new WeakMap<object, number>();
function c676(): void { say("record/proxy-get/weak-map", (wm676.set((new Proxy({ f: make676().m676 as unknown }, {}).f) as object, 1), wm676.has((new Proxy({ f: make676().m676 as unknown }, {}).f) as object))); }

interface R677 { a677: number; m677: () => number }
function make677(): R677 { return { a677: 1, m677: () => 1 }; }
function c677(): void { say("record/proxy-get/written", ((((new Proxy({ f: make677().m677 as unknown }, {}).f)) as any).tag = 1, (((new Proxy({ f: make677().m677 as unknown }, {}).f)) as any).tag)); }

interface R678 { a678: number; m678: () => number }
function make678(): R678 { return { a678: 1, m678: () => 1 }; }
function c678(): void { say("record/proxy-get/defined", (Object.defineProperty((new Proxy({ f: make678().m678 as unknown }, {}).f) as object, "t", { value: 1 }), "t" in ((new Proxy({ f: make678().m678 as unknown }, {}).f) as object))); }

interface R679 { a679: number; m679: () => number }
function make679(): R679 { return { a679: 1, m679: () => 1 }; }
function c679(): void { say("record/proxy-get/frozen", (Object.freeze((new Proxy({ f: make679().m679 as unknown }, {}).f)), Object.isFrozen((new Proxy({ f: make679().m679 as unknown }, {}).f)))); }

interface R680 { a680: number; m680: () => number }
function make680(): R680 { return { a680: 1, m680: () => 1 }; }
function c680(): void { say("record/proxy-get/prototype-set", (Object.setPrototypeOf((new Proxy({ f: make680().m680 as unknown }, {}).f) as object, null), Object.getPrototypeOf((new Proxy({ f: make680().m680 as unknown }, {}).f)) === null)); }

interface R681 { a681: number; m681: () => number }
function make681(): R681 { return { a681: 1, m681: () => 1 }; }
function c681(): void { say("record/proxy-get/deleted", (delete (((new Proxy({ f: make681().m681 as unknown }, {}).f)) as any).length, Object.hasOwn((new Proxy({ f: make681().m681 as unknown }, {}).f) as object, "length"))); }

interface R682 { a682: number; m682: () => number }
function make682(): R682 { return { a682: 1, m682: () => 1 }; }
function same682(a: unknown, b: unknown): boolean { return a === b; }
function c682(): void { say("record/proxy-get/in-a-callee", same682((new Proxy({ f: make682().m682 as unknown }, {}).f), (new Proxy({ f: make682().m682 as unknown }, {}).f))); }

interface R683 { a683: number; m683: () => number }
function make683(): R683 { return { a683: 1, m683: () => 1 }; }
function hit683(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c683(): void { say("record/proxy-get/switch", hit683((new Proxy({ f: make683().m683 as unknown }, {}).f), (new Proxy({ f: make683().m683 as unknown }, {}).f))); }

interface R684 { a684: number; m684: () => number }
function make684(): R684 { return { a684: 1, m684: () => 1 }; }
let last684: unknown;
function seen684(f: unknown): boolean { const same = f === last684; last684 = f; return same; }
function c684(): void { say("record/proxy-get/kept-then-compared", (seen684((new Proxy({ f: make684().m684 as unknown }, {}).f)), seen684((new Proxy({ f: make684().m684 as unknown }, {}).f)))); }

interface R685 { a685: number; m685: () => number }
function make685(): R685 { return { a685: 1, m685: () => 1 }; }
function c685(): void { say("record/prototype-chain/strict-eq", (Object.create({ f: make685().m685 }).f) === (Object.create({ f: make685().m685 }).f)); }

interface R686 { a686: number; m686: () => number }
function make686(): R686 { return { a686: 1, m686: () => 1 }; }
function c686(): void { say("record/prototype-chain/strict-ne", (Object.create({ f: make686().m686 }).f) !== (Object.create({ f: make686().m686 }).f)); }

interface R687 { a687: number; m687: () => number }
function make687(): R687 { return { a687: 1, m687: () => 1 }; }
function c687(): void { say("record/prototype-chain/loose-eq", (Object.create({ f: make687().m687 }).f) == (Object.create({ f: make687().m687 }).f)); }

interface R688 { a688: number; m688: () => number }
function make688(): R688 { return { a688: 1, m688: () => 1 }; }
function c688(): void { say("record/prototype-chain/object-is", Object.is((Object.create({ f: make688().m688 }).f), (Object.create({ f: make688().m688 }).f))); }

interface R689 { a689: number; m689: () => number }
function make689(): R689 { return { a689: 1, m689: () => 1 }; }
function c689(): void { say("record/prototype-chain/set", new Set([(Object.create({ f: make689().m689 }).f), (Object.create({ f: make689().m689 }).f)]).size); }

interface R690 { a690: number; m690: () => number }
function make690(): R690 { return { a690: 1, m690: () => 1 }; }
function c690(): void { say("record/prototype-chain/map-key", new Map([[(Object.create({ f: make690().m690 }).f), 1], [(Object.create({ f: make690().m690 }).f), 2]]).size); }

interface R691 { a691: number; m691: () => number }
function make691(): R691 { return { a691: 1, m691: () => 1 }; }
function c691(): void { say("record/prototype-chain/includes", [(Object.create({ f: make691().m691 }).f)].includes((Object.create({ f: make691().m691 }).f))); }

interface R692 { a692: number; m692: () => number }
function make692(): R692 { return { a692: 1, m692: () => 1 }; }
function c692(): void { say("record/prototype-chain/index-of", [(Object.create({ f: make692().m692 }).f)].indexOf((Object.create({ f: make692().m692 }).f))); }

interface R693 { a693: number; m693: () => number }
function make693(): R693 { return { a693: 1, m693: () => 1 }; }
const ws693 = new WeakSet<object>();
function c693(): void { say("record/prototype-chain/weak-set", (ws693.add((Object.create({ f: make693().m693 }).f) as object), ws693.has((Object.create({ f: make693().m693 }).f) as object))); }

interface R694 { a694: number; m694: () => number }
function make694(): R694 { return { a694: 1, m694: () => 1 }; }
const wm694 = new WeakMap<object, number>();
function c694(): void { say("record/prototype-chain/weak-map", (wm694.set((Object.create({ f: make694().m694 }).f) as object, 1), wm694.has((Object.create({ f: make694().m694 }).f) as object))); }

interface R695 { a695: number; m695: () => number }
function make695(): R695 { return { a695: 1, m695: () => 1 }; }
function c695(): void { say("record/prototype-chain/written", ((((Object.create({ f: make695().m695 }).f)) as any).tag = 1, (((Object.create({ f: make695().m695 }).f)) as any).tag)); }

interface R696 { a696: number; m696: () => number }
function make696(): R696 { return { a696: 1, m696: () => 1 }; }
function c696(): void { say("record/prototype-chain/defined", (Object.defineProperty((Object.create({ f: make696().m696 }).f) as object, "t", { value: 1 }), "t" in ((Object.create({ f: make696().m696 }).f) as object))); }

interface R697 { a697: number; m697: () => number }
function make697(): R697 { return { a697: 1, m697: () => 1 }; }
function c697(): void { say("record/prototype-chain/frozen", (Object.freeze((Object.create({ f: make697().m697 }).f)), Object.isFrozen((Object.create({ f: make697().m697 }).f)))); }

interface R698 { a698: number; m698: () => number }
function make698(): R698 { return { a698: 1, m698: () => 1 }; }
function c698(): void { say("record/prototype-chain/prototype-set", (Object.setPrototypeOf((Object.create({ f: make698().m698 }).f) as object, null), Object.getPrototypeOf((Object.create({ f: make698().m698 }).f)) === null)); }

interface R699 { a699: number; m699: () => number }
function make699(): R699 { return { a699: 1, m699: () => 1 }; }
function c699(): void { say("record/prototype-chain/deleted", (delete (((Object.create({ f: make699().m699 }).f)) as any).length, Object.hasOwn((Object.create({ f: make699().m699 }).f) as object, "length"))); }

interface R700 { a700: number; m700: () => number }
function make700(): R700 { return { a700: 1, m700: () => 1 }; }
function same700(a: unknown, b: unknown): boolean { return a === b; }
function c700(): void { say("record/prototype-chain/in-a-callee", same700((Object.create({ f: make700().m700 }).f), (Object.create({ f: make700().m700 }).f))); }

interface R701 { a701: number; m701: () => number }
function make701(): R701 { return { a701: 1, m701: () => 1 }; }
function hit701(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c701(): void { say("record/prototype-chain/switch", hit701((Object.create({ f: make701().m701 }).f), (Object.create({ f: make701().m701 }).f))); }

interface R702 { a702: number; m702: () => number }
function make702(): R702 { return { a702: 1, m702: () => 1 }; }
let last702: unknown;
function seen702(f: unknown): boolean { const same = f === last702; last702 = f; return same; }
function c702(): void { say("record/prototype-chain/kept-then-compared", (seen702((Object.create({ f: make702().m702 }).f)), seen702((Object.create({ f: make702().m702 }).f)))); }

interface R703 { a703: number; m703: () => number }
function make703(): R703 { return { a703: 1, m703: () => 1 }; }
function c703(): void { say("record/weak-ref/strict-eq", (new WeakRef(make703().m703 as object).deref()) === (new WeakRef(make703().m703 as object).deref())); }

interface R704 { a704: number; m704: () => number }
function make704(): R704 { return { a704: 1, m704: () => 1 }; }
function c704(): void { say("record/weak-ref/strict-ne", (new WeakRef(make704().m704 as object).deref()) !== (new WeakRef(make704().m704 as object).deref())); }

interface R705 { a705: number; m705: () => number }
function make705(): R705 { return { a705: 1, m705: () => 1 }; }
function c705(): void { say("record/weak-ref/loose-eq", (new WeakRef(make705().m705 as object).deref()) == (new WeakRef(make705().m705 as object).deref())); }

interface R706 { a706: number; m706: () => number }
function make706(): R706 { return { a706: 1, m706: () => 1 }; }
function c706(): void { say("record/weak-ref/object-is", Object.is((new WeakRef(make706().m706 as object).deref()), (new WeakRef(make706().m706 as object).deref()))); }

interface R707 { a707: number; m707: () => number }
function make707(): R707 { return { a707: 1, m707: () => 1 }; }
function c707(): void { say("record/weak-ref/set", new Set([(new WeakRef(make707().m707 as object).deref()), (new WeakRef(make707().m707 as object).deref())]).size); }

interface R708 { a708: number; m708: () => number }
function make708(): R708 { return { a708: 1, m708: () => 1 }; }
function c708(): void { say("record/weak-ref/map-key", new Map([[(new WeakRef(make708().m708 as object).deref()), 1], [(new WeakRef(make708().m708 as object).deref()), 2]]).size); }

interface R709 { a709: number; m709: () => number }
function make709(): R709 { return { a709: 1, m709: () => 1 }; }
function c709(): void { say("record/weak-ref/includes", [(new WeakRef(make709().m709 as object).deref())].includes((new WeakRef(make709().m709 as object).deref()))); }

interface R710 { a710: number; m710: () => number }
function make710(): R710 { return { a710: 1, m710: () => 1 }; }
function c710(): void { say("record/weak-ref/index-of", [(new WeakRef(make710().m710 as object).deref())].indexOf((new WeakRef(make710().m710 as object).deref()))); }

interface R711 { a711: number; m711: () => number }
function make711(): R711 { return { a711: 1, m711: () => 1 }; }
const ws711 = new WeakSet<object>();
function c711(): void { say("record/weak-ref/weak-set", (ws711.add((new WeakRef(make711().m711 as object).deref()) as object), ws711.has((new WeakRef(make711().m711 as object).deref()) as object))); }

interface R712 { a712: number; m712: () => number }
function make712(): R712 { return { a712: 1, m712: () => 1 }; }
const wm712 = new WeakMap<object, number>();
function c712(): void { say("record/weak-ref/weak-map", (wm712.set((new WeakRef(make712().m712 as object).deref()) as object, 1), wm712.has((new WeakRef(make712().m712 as object).deref()) as object))); }

interface R713 { a713: number; m713: () => number }
function make713(): R713 { return { a713: 1, m713: () => 1 }; }
function c713(): void { say("record/weak-ref/written", ((((new WeakRef(make713().m713 as object).deref())) as any).tag = 1, (((new WeakRef(make713().m713 as object).deref())) as any).tag)); }

interface R714 { a714: number; m714: () => number }
function make714(): R714 { return { a714: 1, m714: () => 1 }; }
function c714(): void { say("record/weak-ref/defined", (Object.defineProperty((new WeakRef(make714().m714 as object).deref()) as object, "t", { value: 1 }), "t" in ((new WeakRef(make714().m714 as object).deref()) as object))); }

interface R715 { a715: number; m715: () => number }
function make715(): R715 { return { a715: 1, m715: () => 1 }; }
function c715(): void { say("record/weak-ref/frozen", (Object.freeze((new WeakRef(make715().m715 as object).deref())), Object.isFrozen((new WeakRef(make715().m715 as object).deref())))); }

interface R716 { a716: number; m716: () => number }
function make716(): R716 { return { a716: 1, m716: () => 1 }; }
function c716(): void { say("record/weak-ref/prototype-set", (Object.setPrototypeOf((new WeakRef(make716().m716 as object).deref()) as object, null), Object.getPrototypeOf((new WeakRef(make716().m716 as object).deref())) === null)); }

interface R717 { a717: number; m717: () => number }
function make717(): R717 { return { a717: 1, m717: () => 1 }; }
function c717(): void { say("record/weak-ref/deleted", (delete (((new WeakRef(make717().m717 as object).deref())) as any).length, Object.hasOwn((new WeakRef(make717().m717 as object).deref()) as object, "length"))); }

interface R718 { a718: number; m718: () => number }
function make718(): R718 { return { a718: 1, m718: () => 1 }; }
function same718(a: unknown, b: unknown): boolean { return a === b; }
function c718(): void { say("record/weak-ref/in-a-callee", same718((new WeakRef(make718().m718 as object).deref()), (new WeakRef(make718().m718 as object).deref()))); }

interface R719 { a719: number; m719: () => number }
function make719(): R719 { return { a719: 1, m719: () => 1 }; }
function hit719(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c719(): void { say("record/weak-ref/switch", hit719((new WeakRef(make719().m719 as object).deref()), (new WeakRef(make719().m719 as object).deref()))); }

interface R720 { a720: number; m720: () => number }
function make720(): R720 { return { a720: 1, m720: () => 1 }; }
let last720: unknown;
function seen720(f: unknown): boolean { const same = f === last720; last720 = f; return same; }
function c720(): void { say("record/weak-ref/kept-then-compared", (seen720((new WeakRef(make720().m720 as object).deref())), seen720((new WeakRef(make720().m720 as object).deref())))); }

c661(); c662(); c663(); c664(); c665(); c666(); c667(); c668(); c669(); c670(); c671(); c672(); c673(); c674(); c675(); c676(); c677(); c678(); c679(); c680(); c681(); c682(); c683(); c684(); c685(); c686(); c687(); c688(); c689(); c690(); c691(); c692(); c693(); c694(); c695(); c696(); c697(); c698(); c699(); c700(); c701(); c702(); c703(); c704(); c705(); c706(); c707(); c708(); c709(); c710(); c711(); c712(); c713(); c714(); c715(); c716(); c717(); c718(); c719(); c720();
console.log(out.join("\n"));
