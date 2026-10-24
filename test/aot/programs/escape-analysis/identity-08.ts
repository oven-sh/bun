// Generated program: object and closure identity stays observable when allocations are removed (part 8).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R481 { a481: number; m481: () => number }
function make481(): R481 { return { a481: 1, m481: () => 1 }; }
function c481(): void { say("record/spread/frozen", (Object.freeze((({ ...make481() }).m481)), Object.isFrozen((({ ...make481() }).m481)))); }

interface R482 { a482: number; m482: () => number }
function make482(): R482 { return { a482: 1, m482: () => 1 }; }
function c482(): void { say("record/spread/prototype-set", (Object.setPrototypeOf((({ ...make482() }).m482) as object, null), Object.getPrototypeOf((({ ...make482() }).m482)) === null)); }

interface R483 { a483: number; m483: () => number }
function make483(): R483 { return { a483: 1, m483: () => 1 }; }
function c483(): void { say("record/spread/deleted", (delete (((({ ...make483() }).m483)) as any).length, Object.hasOwn((({ ...make483() }).m483) as object, "length"))); }

interface R484 { a484: number; m484: () => number }
function make484(): R484 { return { a484: 1, m484: () => 1 }; }
function same484(a: unknown, b: unknown): boolean { return a === b; }
function c484(): void { say("record/spread/in-a-callee", same484((({ ...make484() }).m484), (({ ...make484() }).m484))); }

interface R485 { a485: number; m485: () => number }
function make485(): R485 { return { a485: 1, m485: () => 1 }; }
function hit485(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c485(): void { say("record/spread/switch", hit485((({ ...make485() }).m485), (({ ...make485() }).m485))); }

interface R486 { a486: number; m486: () => number }
function make486(): R486 { return { a486: 1, m486: () => 1 }; }
let last486: unknown;
function seen486(f: unknown): boolean { const same = f === last486; last486 = f; return same; }
function c486(): void { say("record/spread/kept-then-compared", (seen486((({ ...make486() }).m486)), seen486((({ ...make486() }).m486)))); }

interface R487 { a487: number; m487: () => number }
function make487(): R487 { return { a487: 1, m487: () => 1 }; }
function c487(): void { say("record/assign/strict-eq", (Object.assign({}, make487()).m487) === (Object.assign({}, make487()).m487)); }

interface R488 { a488: number; m488: () => number }
function make488(): R488 { return { a488: 1, m488: () => 1 }; }
function c488(): void { say("record/assign/strict-ne", (Object.assign({}, make488()).m488) !== (Object.assign({}, make488()).m488)); }

interface R489 { a489: number; m489: () => number }
function make489(): R489 { return { a489: 1, m489: () => 1 }; }
function c489(): void { say("record/assign/loose-eq", (Object.assign({}, make489()).m489) == (Object.assign({}, make489()).m489)); }

interface R490 { a490: number; m490: () => number }
function make490(): R490 { return { a490: 1, m490: () => 1 }; }
function c490(): void { say("record/assign/object-is", Object.is((Object.assign({}, make490()).m490), (Object.assign({}, make490()).m490))); }

interface R491 { a491: number; m491: () => number }
function make491(): R491 { return { a491: 1, m491: () => 1 }; }
function c491(): void { say("record/assign/set", new Set([(Object.assign({}, make491()).m491), (Object.assign({}, make491()).m491)]).size); }

interface R492 { a492: number; m492: () => number }
function make492(): R492 { return { a492: 1, m492: () => 1 }; }
function c492(): void { say("record/assign/map-key", new Map([[(Object.assign({}, make492()).m492), 1], [(Object.assign({}, make492()).m492), 2]]).size); }

interface R493 { a493: number; m493: () => number }
function make493(): R493 { return { a493: 1, m493: () => 1 }; }
function c493(): void { say("record/assign/includes", [(Object.assign({}, make493()).m493)].includes((Object.assign({}, make493()).m493))); }

interface R494 { a494: number; m494: () => number }
function make494(): R494 { return { a494: 1, m494: () => 1 }; }
function c494(): void { say("record/assign/index-of", [(Object.assign({}, make494()).m494)].indexOf((Object.assign({}, make494()).m494))); }

interface R495 { a495: number; m495: () => number }
function make495(): R495 { return { a495: 1, m495: () => 1 }; }
const ws495 = new WeakSet<object>();
function c495(): void { say("record/assign/weak-set", (ws495.add((Object.assign({}, make495()).m495) as object), ws495.has((Object.assign({}, make495()).m495) as object))); }

interface R496 { a496: number; m496: () => number }
function make496(): R496 { return { a496: 1, m496: () => 1 }; }
const wm496 = new WeakMap<object, number>();
function c496(): void { say("record/assign/weak-map", (wm496.set((Object.assign({}, make496()).m496) as object, 1), wm496.has((Object.assign({}, make496()).m496) as object))); }

interface R497 { a497: number; m497: () => number }
function make497(): R497 { return { a497: 1, m497: () => 1 }; }
function c497(): void { say("record/assign/written", ((((Object.assign({}, make497()).m497)) as any).tag = 1, (((Object.assign({}, make497()).m497)) as any).tag)); }

interface R498 { a498: number; m498: () => number }
function make498(): R498 { return { a498: 1, m498: () => 1 }; }
function c498(): void { say("record/assign/defined", (Object.defineProperty((Object.assign({}, make498()).m498) as object, "t", { value: 1 }), "t" in ((Object.assign({}, make498()).m498) as object))); }

interface R499 { a499: number; m499: () => number }
function make499(): R499 { return { a499: 1, m499: () => 1 }; }
function c499(): void { say("record/assign/frozen", (Object.freeze((Object.assign({}, make499()).m499)), Object.isFrozen((Object.assign({}, make499()).m499)))); }

interface R500 { a500: number; m500: () => number }
function make500(): R500 { return { a500: 1, m500: () => 1 }; }
function c500(): void { say("record/assign/prototype-set", (Object.setPrototypeOf((Object.assign({}, make500()).m500) as object, null), Object.getPrototypeOf((Object.assign({}, make500()).m500)) === null)); }

interface R501 { a501: number; m501: () => number }
function make501(): R501 { return { a501: 1, m501: () => 1 }; }
function c501(): void { say("record/assign/deleted", (delete (((Object.assign({}, make501()).m501)) as any).length, Object.hasOwn((Object.assign({}, make501()).m501) as object, "length"))); }

interface R502 { a502: number; m502: () => number }
function make502(): R502 { return { a502: 1, m502: () => 1 }; }
function same502(a: unknown, b: unknown): boolean { return a === b; }
function c502(): void { say("record/assign/in-a-callee", same502((Object.assign({}, make502()).m502), (Object.assign({}, make502()).m502))); }

interface R503 { a503: number; m503: () => number }
function make503(): R503 { return { a503: 1, m503: () => 1 }; }
function hit503(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c503(): void { say("record/assign/switch", hit503((Object.assign({}, make503()).m503), (Object.assign({}, make503()).m503))); }

interface R504 { a504: number; m504: () => number }
function make504(): R504 { return { a504: 1, m504: () => 1 }; }
let last504: unknown;
function seen504(f: unknown): boolean { const same = f === last504; last504 = f; return same; }
function c504(): void { say("record/assign/kept-then-compared", (seen504((Object.assign({}, make504()).m504)), seen504((Object.assign({}, make504()).m504)))); }

interface R505 { a505: number; m505: () => number }
function make505(): R505 { return { a505: 1, m505: () => 1 }; }
function get505(): unknown { const { m505 } = make505(); return m505; }
function c505(): void { say("record/pattern/strict-eq", (get505()) === (get505())); }

interface R506 { a506: number; m506: () => number }
function make506(): R506 { return { a506: 1, m506: () => 1 }; }
function get506(): unknown { const { m506 } = make506(); return m506; }
function c506(): void { say("record/pattern/strict-ne", (get506()) !== (get506())); }

interface R507 { a507: number; m507: () => number }
function make507(): R507 { return { a507: 1, m507: () => 1 }; }
function get507(): unknown { const { m507 } = make507(); return m507; }
function c507(): void { say("record/pattern/loose-eq", (get507()) == (get507())); }

interface R508 { a508: number; m508: () => number }
function make508(): R508 { return { a508: 1, m508: () => 1 }; }
function get508(): unknown { const { m508 } = make508(); return m508; }
function c508(): void { say("record/pattern/object-is", Object.is((get508()), (get508()))); }

interface R509 { a509: number; m509: () => number }
function make509(): R509 { return { a509: 1, m509: () => 1 }; }
function get509(): unknown { const { m509 } = make509(); return m509; }
function c509(): void { say("record/pattern/set", new Set([(get509()), (get509())]).size); }

interface R510 { a510: number; m510: () => number }
function make510(): R510 { return { a510: 1, m510: () => 1 }; }
function get510(): unknown { const { m510 } = make510(); return m510; }
function c510(): void { say("record/pattern/map-key", new Map([[(get510()), 1], [(get510()), 2]]).size); }

interface R511 { a511: number; m511: () => number }
function make511(): R511 { return { a511: 1, m511: () => 1 }; }
function get511(): unknown { const { m511 } = make511(); return m511; }
function c511(): void { say("record/pattern/includes", [(get511())].includes((get511()))); }

interface R512 { a512: number; m512: () => number }
function make512(): R512 { return { a512: 1, m512: () => 1 }; }
function get512(): unknown { const { m512 } = make512(); return m512; }
function c512(): void { say("record/pattern/index-of", [(get512())].indexOf((get512()))); }

interface R513 { a513: number; m513: () => number }
function make513(): R513 { return { a513: 1, m513: () => 1 }; }
function get513(): unknown { const { m513 } = make513(); return m513; }
const ws513 = new WeakSet<object>();
function c513(): void { say("record/pattern/weak-set", (ws513.add((get513()) as object), ws513.has((get513()) as object))); }

interface R514 { a514: number; m514: () => number }
function make514(): R514 { return { a514: 1, m514: () => 1 }; }
function get514(): unknown { const { m514 } = make514(); return m514; }
const wm514 = new WeakMap<object, number>();
function c514(): void { say("record/pattern/weak-map", (wm514.set((get514()) as object, 1), wm514.has((get514()) as object))); }

interface R515 { a515: number; m515: () => number }
function make515(): R515 { return { a515: 1, m515: () => 1 }; }
function get515(): unknown { const { m515 } = make515(); return m515; }
function c515(): void { say("record/pattern/written", ((((get515())) as any).tag = 1, (((get515())) as any).tag)); }

interface R516 { a516: number; m516: () => number }
function make516(): R516 { return { a516: 1, m516: () => 1 }; }
function get516(): unknown { const { m516 } = make516(); return m516; }
function c516(): void { say("record/pattern/defined", (Object.defineProperty((get516()) as object, "t", { value: 1 }), "t" in ((get516()) as object))); }

interface R517 { a517: number; m517: () => number }
function make517(): R517 { return { a517: 1, m517: () => 1 }; }
function get517(): unknown { const { m517 } = make517(); return m517; }
function c517(): void { say("record/pattern/frozen", (Object.freeze((get517())), Object.isFrozen((get517())))); }

interface R518 { a518: number; m518: () => number }
function make518(): R518 { return { a518: 1, m518: () => 1 }; }
function get518(): unknown { const { m518 } = make518(); return m518; }
function c518(): void { say("record/pattern/prototype-set", (Object.setPrototypeOf((get518()) as object, null), Object.getPrototypeOf((get518())) === null)); }

interface R519 { a519: number; m519: () => number }
function make519(): R519 { return { a519: 1, m519: () => 1 }; }
function get519(): unknown { const { m519 } = make519(); return m519; }
function c519(): void { say("record/pattern/deleted", (delete (((get519())) as any).length, Object.hasOwn((get519()) as object, "length"))); }

interface R520 { a520: number; m520: () => number }
function make520(): R520 { return { a520: 1, m520: () => 1 }; }
function get520(): unknown { const { m520 } = make520(); return m520; }
function same520(a: unknown, b: unknown): boolean { return a === b; }
function c520(): void { say("record/pattern/in-a-callee", same520((get520()), (get520()))); }

interface R521 { a521: number; m521: () => number }
function make521(): R521 { return { a521: 1, m521: () => 1 }; }
function get521(): unknown { const { m521 } = make521(); return m521; }
function hit521(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c521(): void { say("record/pattern/switch", hit521((get521()), (get521()))); }

interface R522 { a522: number; m522: () => number }
function make522(): R522 { return { a522: 1, m522: () => 1 }; }
function get522(): unknown { const { m522 } = make522(); return m522; }
let last522: unknown;
function seen522(f: unknown): boolean { const same = f === last522; last522 = f; return same; }
function c522(): void { say("record/pattern/kept-then-compared", (seen522((get522())), seen522((get522())))); }

interface R523 { a523: number; m523: () => number }
function make523(): R523 { return { a523: 1, m523: () => 1 }; }
function get523(): unknown { const { a523: _a, ...rest } = make523(); return rest.m523; }
function c523(): void { say("record/rest-pattern/strict-eq", (get523()) === (get523())); }

interface R524 { a524: number; m524: () => number }
function make524(): R524 { return { a524: 1, m524: () => 1 }; }
function get524(): unknown { const { a524: _a, ...rest } = make524(); return rest.m524; }
function c524(): void { say("record/rest-pattern/strict-ne", (get524()) !== (get524())); }

interface R525 { a525: number; m525: () => number }
function make525(): R525 { return { a525: 1, m525: () => 1 }; }
function get525(): unknown { const { a525: _a, ...rest } = make525(); return rest.m525; }
function c525(): void { say("record/rest-pattern/loose-eq", (get525()) == (get525())); }

interface R526 { a526: number; m526: () => number }
function make526(): R526 { return { a526: 1, m526: () => 1 }; }
function get526(): unknown { const { a526: _a, ...rest } = make526(); return rest.m526; }
function c526(): void { say("record/rest-pattern/object-is", Object.is((get526()), (get526()))); }

interface R527 { a527: number; m527: () => number }
function make527(): R527 { return { a527: 1, m527: () => 1 }; }
function get527(): unknown { const { a527: _a, ...rest } = make527(); return rest.m527; }
function c527(): void { say("record/rest-pattern/set", new Set([(get527()), (get527())]).size); }

interface R528 { a528: number; m528: () => number }
function make528(): R528 { return { a528: 1, m528: () => 1 }; }
function get528(): unknown { const { a528: _a, ...rest } = make528(); return rest.m528; }
function c528(): void { say("record/rest-pattern/map-key", new Map([[(get528()), 1], [(get528()), 2]]).size); }

interface R529 { a529: number; m529: () => number }
function make529(): R529 { return { a529: 1, m529: () => 1 }; }
function get529(): unknown { const { a529: _a, ...rest } = make529(); return rest.m529; }
function c529(): void { say("record/rest-pattern/includes", [(get529())].includes((get529()))); }

interface R530 { a530: number; m530: () => number }
function make530(): R530 { return { a530: 1, m530: () => 1 }; }
function get530(): unknown { const { a530: _a, ...rest } = make530(); return rest.m530; }
function c530(): void { say("record/rest-pattern/index-of", [(get530())].indexOf((get530()))); }

interface R531 { a531: number; m531: () => number }
function make531(): R531 { return { a531: 1, m531: () => 1 }; }
function get531(): unknown { const { a531: _a, ...rest } = make531(); return rest.m531; }
const ws531 = new WeakSet<object>();
function c531(): void { say("record/rest-pattern/weak-set", (ws531.add((get531()) as object), ws531.has((get531()) as object))); }

interface R532 { a532: number; m532: () => number }
function make532(): R532 { return { a532: 1, m532: () => 1 }; }
function get532(): unknown { const { a532: _a, ...rest } = make532(); return rest.m532; }
const wm532 = new WeakMap<object, number>();
function c532(): void { say("record/rest-pattern/weak-map", (wm532.set((get532()) as object, 1), wm532.has((get532()) as object))); }

interface R533 { a533: number; m533: () => number }
function make533(): R533 { return { a533: 1, m533: () => 1 }; }
function get533(): unknown { const { a533: _a, ...rest } = make533(); return rest.m533; }
function c533(): void { say("record/rest-pattern/written", ((((get533())) as any).tag = 1, (((get533())) as any).tag)); }

interface R534 { a534: number; m534: () => number }
function make534(): R534 { return { a534: 1, m534: () => 1 }; }
function get534(): unknown { const { a534: _a, ...rest } = make534(); return rest.m534; }
function c534(): void { say("record/rest-pattern/defined", (Object.defineProperty((get534()) as object, "t", { value: 1 }), "t" in ((get534()) as object))); }

interface R535 { a535: number; m535: () => number }
function make535(): R535 { return { a535: 1, m535: () => 1 }; }
function get535(): unknown { const { a535: _a, ...rest } = make535(); return rest.m535; }
function c535(): void { say("record/rest-pattern/frozen", (Object.freeze((get535())), Object.isFrozen((get535())))); }

interface R536 { a536: number; m536: () => number }
function make536(): R536 { return { a536: 1, m536: () => 1 }; }
function get536(): unknown { const { a536: _a, ...rest } = make536(); return rest.m536; }
function c536(): void { say("record/rest-pattern/prototype-set", (Object.setPrototypeOf((get536()) as object, null), Object.getPrototypeOf((get536())) === null)); }

interface R537 { a537: number; m537: () => number }
function make537(): R537 { return { a537: 1, m537: () => 1 }; }
function get537(): unknown { const { a537: _a, ...rest } = make537(); return rest.m537; }
function c537(): void { say("record/rest-pattern/deleted", (delete (((get537())) as any).length, Object.hasOwn((get537()) as object, "length"))); }

interface R538 { a538: number; m538: () => number }
function make538(): R538 { return { a538: 1, m538: () => 1 }; }
function get538(): unknown { const { a538: _a, ...rest } = make538(); return rest.m538; }
function same538(a: unknown, b: unknown): boolean { return a === b; }
function c538(): void { say("record/rest-pattern/in-a-callee", same538((get538()), (get538()))); }

interface R539 { a539: number; m539: () => number }
function make539(): R539 { return { a539: 1, m539: () => 1 }; }
function get539(): unknown { const { a539: _a, ...rest } = make539(); return rest.m539; }
function hit539(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c539(): void { say("record/rest-pattern/switch", hit539((get539()), (get539()))); }

interface R540 { a540: number; m540: () => number }
function make540(): R540 { return { a540: 1, m540: () => 1 }; }
function get540(): unknown { const { a540: _a, ...rest } = make540(); return rest.m540; }
let last540: unknown;
function seen540(f: unknown): boolean { const same = f === last540; last540 = f; return same; }
function c540(): void { say("record/rest-pattern/kept-then-compared", (seen540((get540())), seen540((get540())))); }

c481(); c482(); c483(); c484(); c485(); c486(); c487(); c488(); c489(); c490(); c491(); c492(); c493(); c494(); c495(); c496(); c497(); c498(); c499(); c500(); c501(); c502(); c503(); c504(); c505(); c506(); c507(); c508(); c509(); c510(); c511(); c512(); c513(); c514(); c515(); c516(); c517(); c518(); c519(); c520(); c521(); c522(); c523(); c524(); c525(); c526(); c527(); c528(); c529(); c530(); c531(); c532(); c533(); c534(); c535(); c536(); c537(); c538(); c539(); c540();
console.log(out.join("\n"));
