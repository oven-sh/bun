// Generated program: object and closure identity stays observable when allocations are removed (second series, part 8).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R481 { a481: number; m481: () => number }
function make481(): R481 { return { a481: 1, m481: () => 1 }; }
function c481(): void { say("record/map-get/frozen", (Object.freeze((new Map([[1, make481().m481]]).get(1))), Object.isFrozen((new Map([[1, make481().m481]]).get(1))))); }

interface R482 { a482: number; m482: () => number }
function make482(): R482 { return { a482: 1, m482: () => 1 }; }
function c482(): void { say("record/map-get/prototype-set", (Object.setPrototypeOf((new Map([[1, make482().m482]]).get(1)) as object, null), Object.getPrototypeOf((new Map([[1, make482().m482]]).get(1))) === null)); }

interface R483 { a483: number; m483: () => number }
function make483(): R483 { return { a483: 1, m483: () => 1 }; }
function c483(): void { say("record/map-get/deleted", (delete (((new Map([[1, make483().m483]]).get(1))) as any).length, Object.hasOwn((new Map([[1, make483().m483]]).get(1)) as object, "length"))); }

interface R484 { a484: number; m484: () => number }
function make484(): R484 { return { a484: 1, m484: () => 1 }; }
function same484(a: unknown, b: unknown): boolean { return a === b; }
function c484(): void { say("record/map-get/in-a-callee", same484((new Map([[1, make484().m484]]).get(1)), (new Map([[1, make484().m484]]).get(1)))); }

interface R485 { a485: number; m485: () => number }
function make485(): R485 { return { a485: 1, m485: () => 1 }; }
function hit485(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c485(): void { say("record/map-get/switch", hit485((new Map([[1, make485().m485]]).get(1)), (new Map([[1, make485().m485]]).get(1)))); }

interface R486 { a486: number; m486: () => number }
function make486(): R486 { return { a486: 1, m486: () => 1 }; }
let last486: unknown;
function seen486(f: unknown): boolean { const same = f === last486; last486 = f; return same; }
function c486(): void { say("record/map-get/kept-then-compared", (seen486((new Map([[1, make486().m486]]).get(1))), seen486((new Map([[1, make486().m486]]).get(1))))); }

interface R487 { a487: number; m487: () => number }
function make487(): R487 { return { a487: 1, m487: () => 1 }; }
function self487(this: unknown): unknown { return this; }
function c487(): void { say("record/bind-this/strict-eq", (self487.bind(make487().m487)()) === (self487.bind(make487().m487)())); }

interface R488 { a488: number; m488: () => number }
function make488(): R488 { return { a488: 1, m488: () => 1 }; }
function self488(this: unknown): unknown { return this; }
function c488(): void { say("record/bind-this/strict-ne", (self488.bind(make488().m488)()) !== (self488.bind(make488().m488)())); }

interface R489 { a489: number; m489: () => number }
function make489(): R489 { return { a489: 1, m489: () => 1 }; }
function self489(this: unknown): unknown { return this; }
function c489(): void { say("record/bind-this/loose-eq", (self489.bind(make489().m489)()) == (self489.bind(make489().m489)())); }

interface R490 { a490: number; m490: () => number }
function make490(): R490 { return { a490: 1, m490: () => 1 }; }
function self490(this: unknown): unknown { return this; }
function c490(): void { say("record/bind-this/object-is", Object.is((self490.bind(make490().m490)()), (self490.bind(make490().m490)()))); }

interface R491 { a491: number; m491: () => number }
function make491(): R491 { return { a491: 1, m491: () => 1 }; }
function self491(this: unknown): unknown { return this; }
function c491(): void { say("record/bind-this/set", new Set([(self491.bind(make491().m491)()), (self491.bind(make491().m491)())]).size); }

interface R492 { a492: number; m492: () => number }
function make492(): R492 { return { a492: 1, m492: () => 1 }; }
function self492(this: unknown): unknown { return this; }
function c492(): void { say("record/bind-this/map-key", new Map([[(self492.bind(make492().m492)()), 1], [(self492.bind(make492().m492)()), 2]]).size); }

interface R493 { a493: number; m493: () => number }
function make493(): R493 { return { a493: 1, m493: () => 1 }; }
function self493(this: unknown): unknown { return this; }
function c493(): void { say("record/bind-this/includes", [(self493.bind(make493().m493)())].includes((self493.bind(make493().m493)()))); }

interface R494 { a494: number; m494: () => number }
function make494(): R494 { return { a494: 1, m494: () => 1 }; }
function self494(this: unknown): unknown { return this; }
function c494(): void { say("record/bind-this/index-of", [(self494.bind(make494().m494)())].indexOf((self494.bind(make494().m494)()))); }

interface R495 { a495: number; m495: () => number }
function make495(): R495 { return { a495: 1, m495: () => 1 }; }
function self495(this: unknown): unknown { return this; }
const ws495 = new WeakSet<object>();
function c495(): void { say("record/bind-this/weak-set", (ws495.add((self495.bind(make495().m495)()) as object), ws495.has((self495.bind(make495().m495)()) as object))); }

interface R496 { a496: number; m496: () => number }
function make496(): R496 { return { a496: 1, m496: () => 1 }; }
function self496(this: unknown): unknown { return this; }
const wm496 = new WeakMap<object, number>();
function c496(): void { say("record/bind-this/weak-map", (wm496.set((self496.bind(make496().m496)()) as object, 1), wm496.has((self496.bind(make496().m496)()) as object))); }

interface R497 { a497: number; m497: () => number }
function make497(): R497 { return { a497: 1, m497: () => 1 }; }
function self497(this: unknown): unknown { return this; }
function c497(): void { say("record/bind-this/written", ((((self497.bind(make497().m497)())) as any).tag = 1, (((self497.bind(make497().m497)())) as any).tag)); }

interface R498 { a498: number; m498: () => number }
function make498(): R498 { return { a498: 1, m498: () => 1 }; }
function self498(this: unknown): unknown { return this; }
function c498(): void { say("record/bind-this/defined", (Object.defineProperty((self498.bind(make498().m498)()) as object, "t", { value: 1 }), "t" in ((self498.bind(make498().m498)()) as object))); }

interface R499 { a499: number; m499: () => number }
function make499(): R499 { return { a499: 1, m499: () => 1 }; }
function self499(this: unknown): unknown { return this; }
function c499(): void { say("record/bind-this/frozen", (Object.freeze((self499.bind(make499().m499)())), Object.isFrozen((self499.bind(make499().m499)())))); }

interface R500 { a500: number; m500: () => number }
function make500(): R500 { return { a500: 1, m500: () => 1 }; }
function self500(this: unknown): unknown { return this; }
function c500(): void { say("record/bind-this/prototype-set", (Object.setPrototypeOf((self500.bind(make500().m500)()) as object, null), Object.getPrototypeOf((self500.bind(make500().m500)())) === null)); }

interface R501 { a501: number; m501: () => number }
function make501(): R501 { return { a501: 1, m501: () => 1 }; }
function self501(this: unknown): unknown { return this; }
function c501(): void { say("record/bind-this/deleted", (delete (((self501.bind(make501().m501)())) as any).length, Object.hasOwn((self501.bind(make501().m501)()) as object, "length"))); }

interface R502 { a502: number; m502: () => number }
function make502(): R502 { return { a502: 1, m502: () => 1 }; }
function self502(this: unknown): unknown { return this; }
function same502(a: unknown, b: unknown): boolean { return a === b; }
function c502(): void { say("record/bind-this/in-a-callee", same502((self502.bind(make502().m502)()), (self502.bind(make502().m502)()))); }

interface R503 { a503: number; m503: () => number }
function make503(): R503 { return { a503: 1, m503: () => 1 }; }
function self503(this: unknown): unknown { return this; }
function hit503(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c503(): void { say("record/bind-this/switch", hit503((self503.bind(make503().m503)()), (self503.bind(make503().m503)()))); }

interface R504 { a504: number; m504: () => number }
function make504(): R504 { return { a504: 1, m504: () => 1 }; }
function self504(this: unknown): unknown { return this; }
let last504: unknown;
function seen504(f: unknown): boolean { const same = f === last504; last504 = f; return same; }
function c504(): void { say("record/bind-this/kept-then-compared", (seen504((self504.bind(make504().m504)())), seen504((self504.bind(make504().m504)())))); }

interface R505 { a505: number; m505: () => number }
function make505(): R505 { return { a505: 1, m505: () => 1 }; }
function self505(this: unknown): unknown { return this; }
function c505(): void { say("record/call-this/strict-eq", (self505.call(make505().m505)) === (self505.call(make505().m505))); }

interface R506 { a506: number; m506: () => number }
function make506(): R506 { return { a506: 1, m506: () => 1 }; }
function self506(this: unknown): unknown { return this; }
function c506(): void { say("record/call-this/strict-ne", (self506.call(make506().m506)) !== (self506.call(make506().m506))); }

interface R507 { a507: number; m507: () => number }
function make507(): R507 { return { a507: 1, m507: () => 1 }; }
function self507(this: unknown): unknown { return this; }
function c507(): void { say("record/call-this/loose-eq", (self507.call(make507().m507)) == (self507.call(make507().m507))); }

interface R508 { a508: number; m508: () => number }
function make508(): R508 { return { a508: 1, m508: () => 1 }; }
function self508(this: unknown): unknown { return this; }
function c508(): void { say("record/call-this/object-is", Object.is((self508.call(make508().m508)), (self508.call(make508().m508)))); }

interface R509 { a509: number; m509: () => number }
function make509(): R509 { return { a509: 1, m509: () => 1 }; }
function self509(this: unknown): unknown { return this; }
function c509(): void { say("record/call-this/set", new Set([(self509.call(make509().m509)), (self509.call(make509().m509))]).size); }

interface R510 { a510: number; m510: () => number }
function make510(): R510 { return { a510: 1, m510: () => 1 }; }
function self510(this: unknown): unknown { return this; }
function c510(): void { say("record/call-this/map-key", new Map([[(self510.call(make510().m510)), 1], [(self510.call(make510().m510)), 2]]).size); }

interface R511 { a511: number; m511: () => number }
function make511(): R511 { return { a511: 1, m511: () => 1 }; }
function self511(this: unknown): unknown { return this; }
function c511(): void { say("record/call-this/includes", [(self511.call(make511().m511))].includes((self511.call(make511().m511)))); }

interface R512 { a512: number; m512: () => number }
function make512(): R512 { return { a512: 1, m512: () => 1 }; }
function self512(this: unknown): unknown { return this; }
function c512(): void { say("record/call-this/index-of", [(self512.call(make512().m512))].indexOf((self512.call(make512().m512)))); }

interface R513 { a513: number; m513: () => number }
function make513(): R513 { return { a513: 1, m513: () => 1 }; }
function self513(this: unknown): unknown { return this; }
const ws513 = new WeakSet<object>();
function c513(): void { say("record/call-this/weak-set", (ws513.add((self513.call(make513().m513)) as object), ws513.has((self513.call(make513().m513)) as object))); }

interface R514 { a514: number; m514: () => number }
function make514(): R514 { return { a514: 1, m514: () => 1 }; }
function self514(this: unknown): unknown { return this; }
const wm514 = new WeakMap<object, number>();
function c514(): void { say("record/call-this/weak-map", (wm514.set((self514.call(make514().m514)) as object, 1), wm514.has((self514.call(make514().m514)) as object))); }

interface R515 { a515: number; m515: () => number }
function make515(): R515 { return { a515: 1, m515: () => 1 }; }
function self515(this: unknown): unknown { return this; }
function c515(): void { say("record/call-this/written", ((((self515.call(make515().m515))) as any).tag = 1, (((self515.call(make515().m515))) as any).tag)); }

interface R516 { a516: number; m516: () => number }
function make516(): R516 { return { a516: 1, m516: () => 1 }; }
function self516(this: unknown): unknown { return this; }
function c516(): void { say("record/call-this/defined", (Object.defineProperty((self516.call(make516().m516)) as object, "t", { value: 1 }), "t" in ((self516.call(make516().m516)) as object))); }

interface R517 { a517: number; m517: () => number }
function make517(): R517 { return { a517: 1, m517: () => 1 }; }
function self517(this: unknown): unknown { return this; }
function c517(): void { say("record/call-this/frozen", (Object.freeze((self517.call(make517().m517))), Object.isFrozen((self517.call(make517().m517))))); }

interface R518 { a518: number; m518: () => number }
function make518(): R518 { return { a518: 1, m518: () => 1 }; }
function self518(this: unknown): unknown { return this; }
function c518(): void { say("record/call-this/prototype-set", (Object.setPrototypeOf((self518.call(make518().m518)) as object, null), Object.getPrototypeOf((self518.call(make518().m518))) === null)); }

interface R519 { a519: number; m519: () => number }
function make519(): R519 { return { a519: 1, m519: () => 1 }; }
function self519(this: unknown): unknown { return this; }
function c519(): void { say("record/call-this/deleted", (delete (((self519.call(make519().m519))) as any).length, Object.hasOwn((self519.call(make519().m519)) as object, "length"))); }

interface R520 { a520: number; m520: () => number }
function make520(): R520 { return { a520: 1, m520: () => 1 }; }
function self520(this: unknown): unknown { return this; }
function same520(a: unknown, b: unknown): boolean { return a === b; }
function c520(): void { say("record/call-this/in-a-callee", same520((self520.call(make520().m520)), (self520.call(make520().m520)))); }

interface R521 { a521: number; m521: () => number }
function make521(): R521 { return { a521: 1, m521: () => 1 }; }
function self521(this: unknown): unknown { return this; }
function hit521(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c521(): void { say("record/call-this/switch", hit521((self521.call(make521().m521)), (self521.call(make521().m521)))); }

interface R522 { a522: number; m522: () => number }
function make522(): R522 { return { a522: 1, m522: () => 1 }; }
function self522(this: unknown): unknown { return this; }
let last522: unknown;
function seen522(f: unknown): boolean { const same = f === last522; last522 = f; return same; }
function c522(): void { say("record/call-this/kept-then-compared", (seen522((self522.call(make522().m522))), seen522((self522.call(make522().m522))))); }

interface R523 { a523: number; m523: () => number }
function make523(): R523 { return { a523: 1, m523: () => 1 }; }
function first523(x: unknown): unknown { return x; }
function c523(): void { say("record/apply-arguments/strict-eq", (first523.apply(null, [make523().m523])) === (first523.apply(null, [make523().m523]))); }

interface R524 { a524: number; m524: () => number }
function make524(): R524 { return { a524: 1, m524: () => 1 }; }
function first524(x: unknown): unknown { return x; }
function c524(): void { say("record/apply-arguments/strict-ne", (first524.apply(null, [make524().m524])) !== (first524.apply(null, [make524().m524]))); }

interface R525 { a525: number; m525: () => number }
function make525(): R525 { return { a525: 1, m525: () => 1 }; }
function first525(x: unknown): unknown { return x; }
function c525(): void { say("record/apply-arguments/loose-eq", (first525.apply(null, [make525().m525])) == (first525.apply(null, [make525().m525]))); }

interface R526 { a526: number; m526: () => number }
function make526(): R526 { return { a526: 1, m526: () => 1 }; }
function first526(x: unknown): unknown { return x; }
function c526(): void { say("record/apply-arguments/object-is", Object.is((first526.apply(null, [make526().m526])), (first526.apply(null, [make526().m526])))); }

interface R527 { a527: number; m527: () => number }
function make527(): R527 { return { a527: 1, m527: () => 1 }; }
function first527(x: unknown): unknown { return x; }
function c527(): void { say("record/apply-arguments/set", new Set([(first527.apply(null, [make527().m527])), (first527.apply(null, [make527().m527]))]).size); }

interface R528 { a528: number; m528: () => number }
function make528(): R528 { return { a528: 1, m528: () => 1 }; }
function first528(x: unknown): unknown { return x; }
function c528(): void { say("record/apply-arguments/map-key", new Map([[(first528.apply(null, [make528().m528])), 1], [(first528.apply(null, [make528().m528])), 2]]).size); }

interface R529 { a529: number; m529: () => number }
function make529(): R529 { return { a529: 1, m529: () => 1 }; }
function first529(x: unknown): unknown { return x; }
function c529(): void { say("record/apply-arguments/includes", [(first529.apply(null, [make529().m529]))].includes((first529.apply(null, [make529().m529])))); }

interface R530 { a530: number; m530: () => number }
function make530(): R530 { return { a530: 1, m530: () => 1 }; }
function first530(x: unknown): unknown { return x; }
function c530(): void { say("record/apply-arguments/index-of", [(first530.apply(null, [make530().m530]))].indexOf((first530.apply(null, [make530().m530])))); }

interface R531 { a531: number; m531: () => number }
function make531(): R531 { return { a531: 1, m531: () => 1 }; }
function first531(x: unknown): unknown { return x; }
const ws531 = new WeakSet<object>();
function c531(): void { say("record/apply-arguments/weak-set", (ws531.add((first531.apply(null, [make531().m531])) as object), ws531.has((first531.apply(null, [make531().m531])) as object))); }

interface R532 { a532: number; m532: () => number }
function make532(): R532 { return { a532: 1, m532: () => 1 }; }
function first532(x: unknown): unknown { return x; }
const wm532 = new WeakMap<object, number>();
function c532(): void { say("record/apply-arguments/weak-map", (wm532.set((first532.apply(null, [make532().m532])) as object, 1), wm532.has((first532.apply(null, [make532().m532])) as object))); }

interface R533 { a533: number; m533: () => number }
function make533(): R533 { return { a533: 1, m533: () => 1 }; }
function first533(x: unknown): unknown { return x; }
function c533(): void { say("record/apply-arguments/written", ((((first533.apply(null, [make533().m533]))) as any).tag = 1, (((first533.apply(null, [make533().m533]))) as any).tag)); }

interface R534 { a534: number; m534: () => number }
function make534(): R534 { return { a534: 1, m534: () => 1 }; }
function first534(x: unknown): unknown { return x; }
function c534(): void { say("record/apply-arguments/defined", (Object.defineProperty((first534.apply(null, [make534().m534])) as object, "t", { value: 1 }), "t" in ((first534.apply(null, [make534().m534])) as object))); }

interface R535 { a535: number; m535: () => number }
function make535(): R535 { return { a535: 1, m535: () => 1 }; }
function first535(x: unknown): unknown { return x; }
function c535(): void { say("record/apply-arguments/frozen", (Object.freeze((first535.apply(null, [make535().m535]))), Object.isFrozen((first535.apply(null, [make535().m535]))))); }

interface R536 { a536: number; m536: () => number }
function make536(): R536 { return { a536: 1, m536: () => 1 }; }
function first536(x: unknown): unknown { return x; }
function c536(): void { say("record/apply-arguments/prototype-set", (Object.setPrototypeOf((first536.apply(null, [make536().m536])) as object, null), Object.getPrototypeOf((first536.apply(null, [make536().m536]))) === null)); }

interface R537 { a537: number; m537: () => number }
function make537(): R537 { return { a537: 1, m537: () => 1 }; }
function first537(x: unknown): unknown { return x; }
function c537(): void { say("record/apply-arguments/deleted", (delete (((first537.apply(null, [make537().m537]))) as any).length, Object.hasOwn((first537.apply(null, [make537().m537])) as object, "length"))); }

interface R538 { a538: number; m538: () => number }
function make538(): R538 { return { a538: 1, m538: () => 1 }; }
function first538(x: unknown): unknown { return x; }
function same538(a: unknown, b: unknown): boolean { return a === b; }
function c538(): void { say("record/apply-arguments/in-a-callee", same538((first538.apply(null, [make538().m538])), (first538.apply(null, [make538().m538])))); }

interface R539 { a539: number; m539: () => number }
function make539(): R539 { return { a539: 1, m539: () => 1 }; }
function first539(x: unknown): unknown { return x; }
function hit539(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c539(): void { say("record/apply-arguments/switch", hit539((first539.apply(null, [make539().m539])), (first539.apply(null, [make539().m539])))); }

interface R540 { a540: number; m540: () => number }
function make540(): R540 { return { a540: 1, m540: () => 1 }; }
function first540(x: unknown): unknown { return x; }
let last540: unknown;
function seen540(f: unknown): boolean { const same = f === last540; last540 = f; return same; }
function c540(): void { say("record/apply-arguments/kept-then-compared", (seen540((first540.apply(null, [make540().m540]))), seen540((first540.apply(null, [make540().m540]))))); }

c481(); c482(); c483(); c484(); c485(); c486(); c487(); c488(); c489(); c490(); c491(); c492(); c493(); c494(); c495(); c496(); c497(); c498(); c499(); c500(); c501(); c502(); c503(); c504(); c505(); c506(); c507(); c508(); c509(); c510(); c511(); c512(); c513(); c514(); c515(); c516(); c517(); c518(); c519(); c520(); c521(); c522(); c523(); c524(); c525(); c526(); c527(); c528(); c529(); c530(); c531(); c532(); c533(); c534(); c535(); c536(); c537(); c538(); c539(); c540();
console.log(out.join("\n"));
