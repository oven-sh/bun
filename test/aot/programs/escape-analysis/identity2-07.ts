// Generated program: object and closure identity stays observable when allocations are removed (second series, part 7).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R421 { a421: number; m421: () => number }
function make421(): R421 { return { a421: 1, m421: () => 1 }; }
function c421(): void { say("record/array-of/includes", [(Array.of(make421().m421)[0])].includes((Array.of(make421().m421)[0]))); }

interface R422 { a422: number; m422: () => number }
function make422(): R422 { return { a422: 1, m422: () => 1 }; }
function c422(): void { say("record/array-of/index-of", [(Array.of(make422().m422)[0])].indexOf((Array.of(make422().m422)[0]))); }

interface R423 { a423: number; m423: () => number }
function make423(): R423 { return { a423: 1, m423: () => 1 }; }
const ws423 = new WeakSet<object>();
function c423(): void { say("record/array-of/weak-set", (ws423.add((Array.of(make423().m423)[0]) as object), ws423.has((Array.of(make423().m423)[0]) as object))); }

interface R424 { a424: number; m424: () => number }
function make424(): R424 { return { a424: 1, m424: () => 1 }; }
const wm424 = new WeakMap<object, number>();
function c424(): void { say("record/array-of/weak-map", (wm424.set((Array.of(make424().m424)[0]) as object, 1), wm424.has((Array.of(make424().m424)[0]) as object))); }

interface R425 { a425: number; m425: () => number }
function make425(): R425 { return { a425: 1, m425: () => 1 }; }
function c425(): void { say("record/array-of/written", ((((Array.of(make425().m425)[0])) as any).tag = 1, (((Array.of(make425().m425)[0])) as any).tag)); }

interface R426 { a426: number; m426: () => number }
function make426(): R426 { return { a426: 1, m426: () => 1 }; }
function c426(): void { say("record/array-of/defined", (Object.defineProperty((Array.of(make426().m426)[0]) as object, "t", { value: 1 }), "t" in ((Array.of(make426().m426)[0]) as object))); }

interface R427 { a427: number; m427: () => number }
function make427(): R427 { return { a427: 1, m427: () => 1 }; }
function c427(): void { say("record/array-of/frozen", (Object.freeze((Array.of(make427().m427)[0])), Object.isFrozen((Array.of(make427().m427)[0])))); }

interface R428 { a428: number; m428: () => number }
function make428(): R428 { return { a428: 1, m428: () => 1 }; }
function c428(): void { say("record/array-of/prototype-set", (Object.setPrototypeOf((Array.of(make428().m428)[0]) as object, null), Object.getPrototypeOf((Array.of(make428().m428)[0])) === null)); }

interface R429 { a429: number; m429: () => number }
function make429(): R429 { return { a429: 1, m429: () => 1 }; }
function c429(): void { say("record/array-of/deleted", (delete (((Array.of(make429().m429)[0])) as any).length, Object.hasOwn((Array.of(make429().m429)[0]) as object, "length"))); }

interface R430 { a430: number; m430: () => number }
function make430(): R430 { return { a430: 1, m430: () => 1 }; }
function same430(a: unknown, b: unknown): boolean { return a === b; }
function c430(): void { say("record/array-of/in-a-callee", same430((Array.of(make430().m430)[0]), (Array.of(make430().m430)[0]))); }

interface R431 { a431: number; m431: () => number }
function make431(): R431 { return { a431: 1, m431: () => 1 }; }
function hit431(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c431(): void { say("record/array-of/switch", hit431((Array.of(make431().m431)[0]), (Array.of(make431().m431)[0]))); }

interface R432 { a432: number; m432: () => number }
function make432(): R432 { return { a432: 1, m432: () => 1 }; }
let last432: unknown;
function seen432(f: unknown): boolean { const same = f === last432; last432 = f; return same; }
function c432(): void { say("record/array-of/kept-then-compared", (seen432((Array.of(make432().m432)[0])), seen432((Array.of(make432().m432)[0])))); }

interface R433 { a433: number; m433: () => number }
function make433(): R433 { return { a433: 1, m433: () => 1 }; }
function get433(): unknown { const xs: unknown[] = []; xs.push(make433().m433); return xs[0]; }
function c433(): void { say("record/push-then-read/strict-eq", (get433()) === (get433())); }

interface R434 { a434: number; m434: () => number }
function make434(): R434 { return { a434: 1, m434: () => 1 }; }
function get434(): unknown { const xs: unknown[] = []; xs.push(make434().m434); return xs[0]; }
function c434(): void { say("record/push-then-read/strict-ne", (get434()) !== (get434())); }

interface R435 { a435: number; m435: () => number }
function make435(): R435 { return { a435: 1, m435: () => 1 }; }
function get435(): unknown { const xs: unknown[] = []; xs.push(make435().m435); return xs[0]; }
function c435(): void { say("record/push-then-read/loose-eq", (get435()) == (get435())); }

interface R436 { a436: number; m436: () => number }
function make436(): R436 { return { a436: 1, m436: () => 1 }; }
function get436(): unknown { const xs: unknown[] = []; xs.push(make436().m436); return xs[0]; }
function c436(): void { say("record/push-then-read/object-is", Object.is((get436()), (get436()))); }

interface R437 { a437: number; m437: () => number }
function make437(): R437 { return { a437: 1, m437: () => 1 }; }
function get437(): unknown { const xs: unknown[] = []; xs.push(make437().m437); return xs[0]; }
function c437(): void { say("record/push-then-read/set", new Set([(get437()), (get437())]).size); }

interface R438 { a438: number; m438: () => number }
function make438(): R438 { return { a438: 1, m438: () => 1 }; }
function get438(): unknown { const xs: unknown[] = []; xs.push(make438().m438); return xs[0]; }
function c438(): void { say("record/push-then-read/map-key", new Map([[(get438()), 1], [(get438()), 2]]).size); }

interface R439 { a439: number; m439: () => number }
function make439(): R439 { return { a439: 1, m439: () => 1 }; }
function get439(): unknown { const xs: unknown[] = []; xs.push(make439().m439); return xs[0]; }
function c439(): void { say("record/push-then-read/includes", [(get439())].includes((get439()))); }

interface R440 { a440: number; m440: () => number }
function make440(): R440 { return { a440: 1, m440: () => 1 }; }
function get440(): unknown { const xs: unknown[] = []; xs.push(make440().m440); return xs[0]; }
function c440(): void { say("record/push-then-read/index-of", [(get440())].indexOf((get440()))); }

interface R441 { a441: number; m441: () => number }
function make441(): R441 { return { a441: 1, m441: () => 1 }; }
function get441(): unknown { const xs: unknown[] = []; xs.push(make441().m441); return xs[0]; }
const ws441 = new WeakSet<object>();
function c441(): void { say("record/push-then-read/weak-set", (ws441.add((get441()) as object), ws441.has((get441()) as object))); }

interface R442 { a442: number; m442: () => number }
function make442(): R442 { return { a442: 1, m442: () => 1 }; }
function get442(): unknown { const xs: unknown[] = []; xs.push(make442().m442); return xs[0]; }
const wm442 = new WeakMap<object, number>();
function c442(): void { say("record/push-then-read/weak-map", (wm442.set((get442()) as object, 1), wm442.has((get442()) as object))); }

interface R443 { a443: number; m443: () => number }
function make443(): R443 { return { a443: 1, m443: () => 1 }; }
function get443(): unknown { const xs: unknown[] = []; xs.push(make443().m443); return xs[0]; }
function c443(): void { say("record/push-then-read/written", ((((get443())) as any).tag = 1, (((get443())) as any).tag)); }

interface R444 { a444: number; m444: () => number }
function make444(): R444 { return { a444: 1, m444: () => 1 }; }
function get444(): unknown { const xs: unknown[] = []; xs.push(make444().m444); return xs[0]; }
function c444(): void { say("record/push-then-read/defined", (Object.defineProperty((get444()) as object, "t", { value: 1 }), "t" in ((get444()) as object))); }

interface R445 { a445: number; m445: () => number }
function make445(): R445 { return { a445: 1, m445: () => 1 }; }
function get445(): unknown { const xs: unknown[] = []; xs.push(make445().m445); return xs[0]; }
function c445(): void { say("record/push-then-read/frozen", (Object.freeze((get445())), Object.isFrozen((get445())))); }

interface R446 { a446: number; m446: () => number }
function make446(): R446 { return { a446: 1, m446: () => 1 }; }
function get446(): unknown { const xs: unknown[] = []; xs.push(make446().m446); return xs[0]; }
function c446(): void { say("record/push-then-read/prototype-set", (Object.setPrototypeOf((get446()) as object, null), Object.getPrototypeOf((get446())) === null)); }

interface R447 { a447: number; m447: () => number }
function make447(): R447 { return { a447: 1, m447: () => 1 }; }
function get447(): unknown { const xs: unknown[] = []; xs.push(make447().m447); return xs[0]; }
function c447(): void { say("record/push-then-read/deleted", (delete (((get447())) as any).length, Object.hasOwn((get447()) as object, "length"))); }

interface R448 { a448: number; m448: () => number }
function make448(): R448 { return { a448: 1, m448: () => 1 }; }
function get448(): unknown { const xs: unknown[] = []; xs.push(make448().m448); return xs[0]; }
function same448(a: unknown, b: unknown): boolean { return a === b; }
function c448(): void { say("record/push-then-read/in-a-callee", same448((get448()), (get448()))); }

interface R449 { a449: number; m449: () => number }
function make449(): R449 { return { a449: 1, m449: () => 1 }; }
function get449(): unknown { const xs: unknown[] = []; xs.push(make449().m449); return xs[0]; }
function hit449(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c449(): void { say("record/push-then-read/switch", hit449((get449()), (get449()))); }

interface R450 { a450: number; m450: () => number }
function make450(): R450 { return { a450: 1, m450: () => 1 }; }
function get450(): unknown { const xs: unknown[] = []; xs.push(make450().m450); return xs[0]; }
let last450: unknown;
function seen450(f: unknown): boolean { const same = f === last450; last450 = f; return same; }
function c450(): void { say("record/push-then-read/kept-then-compared", (seen450((get450())), seen450((get450())))); }

interface R451 { a451: number; m451: () => number }
function make451(): R451 { return { a451: 1, m451: () => 1 }; }
function c451(): void { say("record/set-iteration/strict-eq", ([...new Set([make451().m451])][0]) === ([...new Set([make451().m451])][0])); }

interface R452 { a452: number; m452: () => number }
function make452(): R452 { return { a452: 1, m452: () => 1 }; }
function c452(): void { say("record/set-iteration/strict-ne", ([...new Set([make452().m452])][0]) !== ([...new Set([make452().m452])][0])); }

interface R453 { a453: number; m453: () => number }
function make453(): R453 { return { a453: 1, m453: () => 1 }; }
function c453(): void { say("record/set-iteration/loose-eq", ([...new Set([make453().m453])][0]) == ([...new Set([make453().m453])][0])); }

interface R454 { a454: number; m454: () => number }
function make454(): R454 { return { a454: 1, m454: () => 1 }; }
function c454(): void { say("record/set-iteration/object-is", Object.is(([...new Set([make454().m454])][0]), ([...new Set([make454().m454])][0]))); }

interface R455 { a455: number; m455: () => number }
function make455(): R455 { return { a455: 1, m455: () => 1 }; }
function c455(): void { say("record/set-iteration/set", new Set([([...new Set([make455().m455])][0]), ([...new Set([make455().m455])][0])]).size); }

interface R456 { a456: number; m456: () => number }
function make456(): R456 { return { a456: 1, m456: () => 1 }; }
function c456(): void { say("record/set-iteration/map-key", new Map([[([...new Set([make456().m456])][0]), 1], [([...new Set([make456().m456])][0]), 2]]).size); }

interface R457 { a457: number; m457: () => number }
function make457(): R457 { return { a457: 1, m457: () => 1 }; }
function c457(): void { say("record/set-iteration/includes", [([...new Set([make457().m457])][0])].includes(([...new Set([make457().m457])][0]))); }

interface R458 { a458: number; m458: () => number }
function make458(): R458 { return { a458: 1, m458: () => 1 }; }
function c458(): void { say("record/set-iteration/index-of", [([...new Set([make458().m458])][0])].indexOf(([...new Set([make458().m458])][0]))); }

interface R459 { a459: number; m459: () => number }
function make459(): R459 { return { a459: 1, m459: () => 1 }; }
const ws459 = new WeakSet<object>();
function c459(): void { say("record/set-iteration/weak-set", (ws459.add(([...new Set([make459().m459])][0]) as object), ws459.has(([...new Set([make459().m459])][0]) as object))); }

interface R460 { a460: number; m460: () => number }
function make460(): R460 { return { a460: 1, m460: () => 1 }; }
const wm460 = new WeakMap<object, number>();
function c460(): void { say("record/set-iteration/weak-map", (wm460.set(([...new Set([make460().m460])][0]) as object, 1), wm460.has(([...new Set([make460().m460])][0]) as object))); }

interface R461 { a461: number; m461: () => number }
function make461(): R461 { return { a461: 1, m461: () => 1 }; }
function c461(): void { say("record/set-iteration/written", (((([...new Set([make461().m461])][0])) as any).tag = 1, ((([...new Set([make461().m461])][0])) as any).tag)); }

interface R462 { a462: number; m462: () => number }
function make462(): R462 { return { a462: 1, m462: () => 1 }; }
function c462(): void { say("record/set-iteration/defined", (Object.defineProperty(([...new Set([make462().m462])][0]) as object, "t", { value: 1 }), "t" in (([...new Set([make462().m462])][0]) as object))); }

interface R463 { a463: number; m463: () => number }
function make463(): R463 { return { a463: 1, m463: () => 1 }; }
function c463(): void { say("record/set-iteration/frozen", (Object.freeze(([...new Set([make463().m463])][0])), Object.isFrozen(([...new Set([make463().m463])][0])))); }

interface R464 { a464: number; m464: () => number }
function make464(): R464 { return { a464: 1, m464: () => 1 }; }
function c464(): void { say("record/set-iteration/prototype-set", (Object.setPrototypeOf(([...new Set([make464().m464])][0]) as object, null), Object.getPrototypeOf(([...new Set([make464().m464])][0])) === null)); }

interface R465 { a465: number; m465: () => number }
function make465(): R465 { return { a465: 1, m465: () => 1 }; }
function c465(): void { say("record/set-iteration/deleted", (delete ((([...new Set([make465().m465])][0])) as any).length, Object.hasOwn(([...new Set([make465().m465])][0]) as object, "length"))); }

interface R466 { a466: number; m466: () => number }
function make466(): R466 { return { a466: 1, m466: () => 1 }; }
function same466(a: unknown, b: unknown): boolean { return a === b; }
function c466(): void { say("record/set-iteration/in-a-callee", same466(([...new Set([make466().m466])][0]), ([...new Set([make466().m466])][0]))); }

interface R467 { a467: number; m467: () => number }
function make467(): R467 { return { a467: 1, m467: () => 1 }; }
function hit467(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c467(): void { say("record/set-iteration/switch", hit467(([...new Set([make467().m467])][0]), ([...new Set([make467().m467])][0]))); }

interface R468 { a468: number; m468: () => number }
function make468(): R468 { return { a468: 1, m468: () => 1 }; }
let last468: unknown;
function seen468(f: unknown): boolean { const same = f === last468; last468 = f; return same; }
function c468(): void { say("record/set-iteration/kept-then-compared", (seen468(([...new Set([make468().m468])][0])), seen468(([...new Set([make468().m468])][0])))); }

interface R469 { a469: number; m469: () => number }
function make469(): R469 { return { a469: 1, m469: () => 1 }; }
function c469(): void { say("record/map-get/strict-eq", (new Map([[1, make469().m469]]).get(1)) === (new Map([[1, make469().m469]]).get(1))); }

interface R470 { a470: number; m470: () => number }
function make470(): R470 { return { a470: 1, m470: () => 1 }; }
function c470(): void { say("record/map-get/strict-ne", (new Map([[1, make470().m470]]).get(1)) !== (new Map([[1, make470().m470]]).get(1))); }

interface R471 { a471: number; m471: () => number }
function make471(): R471 { return { a471: 1, m471: () => 1 }; }
function c471(): void { say("record/map-get/loose-eq", (new Map([[1, make471().m471]]).get(1)) == (new Map([[1, make471().m471]]).get(1))); }

interface R472 { a472: number; m472: () => number }
function make472(): R472 { return { a472: 1, m472: () => 1 }; }
function c472(): void { say("record/map-get/object-is", Object.is((new Map([[1, make472().m472]]).get(1)), (new Map([[1, make472().m472]]).get(1)))); }

interface R473 { a473: number; m473: () => number }
function make473(): R473 { return { a473: 1, m473: () => 1 }; }
function c473(): void { say("record/map-get/set", new Set([(new Map([[1, make473().m473]]).get(1)), (new Map([[1, make473().m473]]).get(1))]).size); }

interface R474 { a474: number; m474: () => number }
function make474(): R474 { return { a474: 1, m474: () => 1 }; }
function c474(): void { say("record/map-get/map-key", new Map([[(new Map([[1, make474().m474]]).get(1)), 1], [(new Map([[1, make474().m474]]).get(1)), 2]]).size); }

interface R475 { a475: number; m475: () => number }
function make475(): R475 { return { a475: 1, m475: () => 1 }; }
function c475(): void { say("record/map-get/includes", [(new Map([[1, make475().m475]]).get(1))].includes((new Map([[1, make475().m475]]).get(1)))); }

interface R476 { a476: number; m476: () => number }
function make476(): R476 { return { a476: 1, m476: () => 1 }; }
function c476(): void { say("record/map-get/index-of", [(new Map([[1, make476().m476]]).get(1))].indexOf((new Map([[1, make476().m476]]).get(1)))); }

interface R477 { a477: number; m477: () => number }
function make477(): R477 { return { a477: 1, m477: () => 1 }; }
const ws477 = new WeakSet<object>();
function c477(): void { say("record/map-get/weak-set", (ws477.add((new Map([[1, make477().m477]]).get(1)) as object), ws477.has((new Map([[1, make477().m477]]).get(1)) as object))); }

interface R478 { a478: number; m478: () => number }
function make478(): R478 { return { a478: 1, m478: () => 1 }; }
const wm478 = new WeakMap<object, number>();
function c478(): void { say("record/map-get/weak-map", (wm478.set((new Map([[1, make478().m478]]).get(1)) as object, 1), wm478.has((new Map([[1, make478().m478]]).get(1)) as object))); }

interface R479 { a479: number; m479: () => number }
function make479(): R479 { return { a479: 1, m479: () => 1 }; }
function c479(): void { say("record/map-get/written", ((((new Map([[1, make479().m479]]).get(1))) as any).tag = 1, (((new Map([[1, make479().m479]]).get(1))) as any).tag)); }

interface R480 { a480: number; m480: () => number }
function make480(): R480 { return { a480: 1, m480: () => 1 }; }
function c480(): void { say("record/map-get/defined", (Object.defineProperty((new Map([[1, make480().m480]]).get(1)) as object, "t", { value: 1 }), "t" in ((new Map([[1, make480().m480]]).get(1)) as object))); }

c421(); c422(); c423(); c424(); c425(); c426(); c427(); c428(); c429(); c430(); c431(); c432(); c433(); c434(); c435(); c436(); c437(); c438(); c439(); c440(); c441(); c442(); c443(); c444(); c445(); c446(); c447(); c448(); c449(); c450(); c451(); c452(); c453(); c454(); c455(); c456(); c457(); c458(); c459(); c460(); c461(); c462(); c463(); c464(); c465(); c466(); c467(); c468(); c469(); c470(); c471(); c472(); c473(); c474(); c475(); c476(); c477(); c478(); c479(); c480();
console.log(out.join("\n"));
