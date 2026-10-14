// Generated program: object and closure identity stays observable when allocations are removed (part 7).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R421 { a421: number; m421: () => number }
function make421(): R421 { return { a421: 1, m421: () => 1 }; }
function c421(): void { say("record/entries/includes", [(Object.entries(make421())[1][1])].includes((Object.entries(make421())[1][1]))); }

interface R422 { a422: number; m422: () => number }
function make422(): R422 { return { a422: 1, m422: () => 1 }; }
function c422(): void { say("record/entries/index-of", [(Object.entries(make422())[1][1])].indexOf((Object.entries(make422())[1][1]))); }

interface R423 { a423: number; m423: () => number }
function make423(): R423 { return { a423: 1, m423: () => 1 }; }
const ws423 = new WeakSet<object>();
function c423(): void { say("record/entries/weak-set", (ws423.add((Object.entries(make423())[1][1]) as object), ws423.has((Object.entries(make423())[1][1]) as object))); }

interface R424 { a424: number; m424: () => number }
function make424(): R424 { return { a424: 1, m424: () => 1 }; }
const wm424 = new WeakMap<object, number>();
function c424(): void { say("record/entries/weak-map", (wm424.set((Object.entries(make424())[1][1]) as object, 1), wm424.has((Object.entries(make424())[1][1]) as object))); }

interface R425 { a425: number; m425: () => number }
function make425(): R425 { return { a425: 1, m425: () => 1 }; }
function c425(): void { say("record/entries/written", ((((Object.entries(make425())[1][1])) as any).tag = 1, (((Object.entries(make425())[1][1])) as any).tag)); }

interface R426 { a426: number; m426: () => number }
function make426(): R426 { return { a426: 1, m426: () => 1 }; }
function c426(): void { say("record/entries/defined", (Object.defineProperty((Object.entries(make426())[1][1]) as object, "t", { value: 1 }), "t" in ((Object.entries(make426())[1][1]) as object))); }

interface R427 { a427: number; m427: () => number }
function make427(): R427 { return { a427: 1, m427: () => 1 }; }
function c427(): void { say("record/entries/frozen", (Object.freeze((Object.entries(make427())[1][1])), Object.isFrozen((Object.entries(make427())[1][1])))); }

interface R428 { a428: number; m428: () => number }
function make428(): R428 { return { a428: 1, m428: () => 1 }; }
function c428(): void { say("record/entries/prototype-set", (Object.setPrototypeOf((Object.entries(make428())[1][1]) as object, null), Object.getPrototypeOf((Object.entries(make428())[1][1])) === null)); }

interface R429 { a429: number; m429: () => number }
function make429(): R429 { return { a429: 1, m429: () => 1 }; }
function c429(): void { say("record/entries/deleted", (delete (((Object.entries(make429())[1][1])) as any).length, Object.hasOwn((Object.entries(make429())[1][1]) as object, "length"))); }

interface R430 { a430: number; m430: () => number }
function make430(): R430 { return { a430: 1, m430: () => 1 }; }
function same430(a: unknown, b: unknown): boolean { return a === b; }
function c430(): void { say("record/entries/in-a-callee", same430((Object.entries(make430())[1][1]), (Object.entries(make430())[1][1]))); }

interface R431 { a431: number; m431: () => number }
function make431(): R431 { return { a431: 1, m431: () => 1 }; }
function hit431(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c431(): void { say("record/entries/switch", hit431((Object.entries(make431())[1][1]), (Object.entries(make431())[1][1]))); }

interface R432 { a432: number; m432: () => number }
function make432(): R432 { return { a432: 1, m432: () => 1 }; }
let last432: unknown;
function seen432(f: unknown): boolean { const same = f === last432; last432 = f; return same; }
function c432(): void { say("record/entries/kept-then-compared", (seen432((Object.entries(make432())[1][1])), seen432((Object.entries(make432())[1][1])))); }

interface R433 { a433: number; m433: () => number }
function make433(): R433 { return { a433: 1, m433: () => 1 }; }
function c433(): void { say("record/descriptor/strict-eq", (Object.getOwnPropertyDescriptor(make433(), "m433")!.value) === (Object.getOwnPropertyDescriptor(make433(), "m433")!.value)); }

interface R434 { a434: number; m434: () => number }
function make434(): R434 { return { a434: 1, m434: () => 1 }; }
function c434(): void { say("record/descriptor/strict-ne", (Object.getOwnPropertyDescriptor(make434(), "m434")!.value) !== (Object.getOwnPropertyDescriptor(make434(), "m434")!.value)); }

interface R435 { a435: number; m435: () => number }
function make435(): R435 { return { a435: 1, m435: () => 1 }; }
function c435(): void { say("record/descriptor/loose-eq", (Object.getOwnPropertyDescriptor(make435(), "m435")!.value) == (Object.getOwnPropertyDescriptor(make435(), "m435")!.value)); }

interface R436 { a436: number; m436: () => number }
function make436(): R436 { return { a436: 1, m436: () => 1 }; }
function c436(): void { say("record/descriptor/object-is", Object.is((Object.getOwnPropertyDescriptor(make436(), "m436")!.value), (Object.getOwnPropertyDescriptor(make436(), "m436")!.value))); }

interface R437 { a437: number; m437: () => number }
function make437(): R437 { return { a437: 1, m437: () => 1 }; }
function c437(): void { say("record/descriptor/set", new Set([(Object.getOwnPropertyDescriptor(make437(), "m437")!.value), (Object.getOwnPropertyDescriptor(make437(), "m437")!.value)]).size); }

interface R438 { a438: number; m438: () => number }
function make438(): R438 { return { a438: 1, m438: () => 1 }; }
function c438(): void { say("record/descriptor/map-key", new Map([[(Object.getOwnPropertyDescriptor(make438(), "m438")!.value), 1], [(Object.getOwnPropertyDescriptor(make438(), "m438")!.value), 2]]).size); }

interface R439 { a439: number; m439: () => number }
function make439(): R439 { return { a439: 1, m439: () => 1 }; }
function c439(): void { say("record/descriptor/includes", [(Object.getOwnPropertyDescriptor(make439(), "m439")!.value)].includes((Object.getOwnPropertyDescriptor(make439(), "m439")!.value))); }

interface R440 { a440: number; m440: () => number }
function make440(): R440 { return { a440: 1, m440: () => 1 }; }
function c440(): void { say("record/descriptor/index-of", [(Object.getOwnPropertyDescriptor(make440(), "m440")!.value)].indexOf((Object.getOwnPropertyDescriptor(make440(), "m440")!.value))); }

interface R441 { a441: number; m441: () => number }
function make441(): R441 { return { a441: 1, m441: () => 1 }; }
const ws441 = new WeakSet<object>();
function c441(): void { say("record/descriptor/weak-set", (ws441.add((Object.getOwnPropertyDescriptor(make441(), "m441")!.value) as object), ws441.has((Object.getOwnPropertyDescriptor(make441(), "m441")!.value) as object))); }

interface R442 { a442: number; m442: () => number }
function make442(): R442 { return { a442: 1, m442: () => 1 }; }
const wm442 = new WeakMap<object, number>();
function c442(): void { say("record/descriptor/weak-map", (wm442.set((Object.getOwnPropertyDescriptor(make442(), "m442")!.value) as object, 1), wm442.has((Object.getOwnPropertyDescriptor(make442(), "m442")!.value) as object))); }

interface R443 { a443: number; m443: () => number }
function make443(): R443 { return { a443: 1, m443: () => 1 }; }
function c443(): void { say("record/descriptor/written", ((((Object.getOwnPropertyDescriptor(make443(), "m443")!.value)) as any).tag = 1, (((Object.getOwnPropertyDescriptor(make443(), "m443")!.value)) as any).tag)); }

interface R444 { a444: number; m444: () => number }
function make444(): R444 { return { a444: 1, m444: () => 1 }; }
function c444(): void { say("record/descriptor/defined", (Object.defineProperty((Object.getOwnPropertyDescriptor(make444(), "m444")!.value) as object, "t", { value: 1 }), "t" in ((Object.getOwnPropertyDescriptor(make444(), "m444")!.value) as object))); }

interface R445 { a445: number; m445: () => number }
function make445(): R445 { return { a445: 1, m445: () => 1 }; }
function c445(): void { say("record/descriptor/frozen", (Object.freeze((Object.getOwnPropertyDescriptor(make445(), "m445")!.value)), Object.isFrozen((Object.getOwnPropertyDescriptor(make445(), "m445")!.value)))); }

interface R446 { a446: number; m446: () => number }
function make446(): R446 { return { a446: 1, m446: () => 1 }; }
function c446(): void { say("record/descriptor/prototype-set", (Object.setPrototypeOf((Object.getOwnPropertyDescriptor(make446(), "m446")!.value) as object, null), Object.getPrototypeOf((Object.getOwnPropertyDescriptor(make446(), "m446")!.value)) === null)); }

interface R447 { a447: number; m447: () => number }
function make447(): R447 { return { a447: 1, m447: () => 1 }; }
function c447(): void { say("record/descriptor/deleted", (delete (((Object.getOwnPropertyDescriptor(make447(), "m447")!.value)) as any).length, Object.hasOwn((Object.getOwnPropertyDescriptor(make447(), "m447")!.value) as object, "length"))); }

interface R448 { a448: number; m448: () => number }
function make448(): R448 { return { a448: 1, m448: () => 1 }; }
function same448(a: unknown, b: unknown): boolean { return a === b; }
function c448(): void { say("record/descriptor/in-a-callee", same448((Object.getOwnPropertyDescriptor(make448(), "m448")!.value), (Object.getOwnPropertyDescriptor(make448(), "m448")!.value))); }

interface R449 { a449: number; m449: () => number }
function make449(): R449 { return { a449: 1, m449: () => 1 }; }
function hit449(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c449(): void { say("record/descriptor/switch", hit449((Object.getOwnPropertyDescriptor(make449(), "m449")!.value), (Object.getOwnPropertyDescriptor(make449(), "m449")!.value))); }

interface R450 { a450: number; m450: () => number }
function make450(): R450 { return { a450: 1, m450: () => 1 }; }
let last450: unknown;
function seen450(f: unknown): boolean { const same = f === last450; last450 = f; return same; }
function c450(): void { say("record/descriptor/kept-then-compared", (seen450((Object.getOwnPropertyDescriptor(make450(), "m450")!.value)), seen450((Object.getOwnPropertyDescriptor(make450(), "m450")!.value)))); }

interface R451 { a451: number; m451: () => number }
function make451(): R451 { return { a451: 1, m451: () => 1 }; }
function c451(): void { say("record/reflect-get/strict-eq", (Reflect.get(make451(), "m451")) === (Reflect.get(make451(), "m451"))); }

interface R452 { a452: number; m452: () => number }
function make452(): R452 { return { a452: 1, m452: () => 1 }; }
function c452(): void { say("record/reflect-get/strict-ne", (Reflect.get(make452(), "m452")) !== (Reflect.get(make452(), "m452"))); }

interface R453 { a453: number; m453: () => number }
function make453(): R453 { return { a453: 1, m453: () => 1 }; }
function c453(): void { say("record/reflect-get/loose-eq", (Reflect.get(make453(), "m453")) == (Reflect.get(make453(), "m453"))); }

interface R454 { a454: number; m454: () => number }
function make454(): R454 { return { a454: 1, m454: () => 1 }; }
function c454(): void { say("record/reflect-get/object-is", Object.is((Reflect.get(make454(), "m454")), (Reflect.get(make454(), "m454")))); }

interface R455 { a455: number; m455: () => number }
function make455(): R455 { return { a455: 1, m455: () => 1 }; }
function c455(): void { say("record/reflect-get/set", new Set([(Reflect.get(make455(), "m455")), (Reflect.get(make455(), "m455"))]).size); }

interface R456 { a456: number; m456: () => number }
function make456(): R456 { return { a456: 1, m456: () => 1 }; }
function c456(): void { say("record/reflect-get/map-key", new Map([[(Reflect.get(make456(), "m456")), 1], [(Reflect.get(make456(), "m456")), 2]]).size); }

interface R457 { a457: number; m457: () => number }
function make457(): R457 { return { a457: 1, m457: () => 1 }; }
function c457(): void { say("record/reflect-get/includes", [(Reflect.get(make457(), "m457"))].includes((Reflect.get(make457(), "m457")))); }

interface R458 { a458: number; m458: () => number }
function make458(): R458 { return { a458: 1, m458: () => 1 }; }
function c458(): void { say("record/reflect-get/index-of", [(Reflect.get(make458(), "m458"))].indexOf((Reflect.get(make458(), "m458")))); }

interface R459 { a459: number; m459: () => number }
function make459(): R459 { return { a459: 1, m459: () => 1 }; }
const ws459 = new WeakSet<object>();
function c459(): void { say("record/reflect-get/weak-set", (ws459.add((Reflect.get(make459(), "m459")) as object), ws459.has((Reflect.get(make459(), "m459")) as object))); }

interface R460 { a460: number; m460: () => number }
function make460(): R460 { return { a460: 1, m460: () => 1 }; }
const wm460 = new WeakMap<object, number>();
function c460(): void { say("record/reflect-get/weak-map", (wm460.set((Reflect.get(make460(), "m460")) as object, 1), wm460.has((Reflect.get(make460(), "m460")) as object))); }

interface R461 { a461: number; m461: () => number }
function make461(): R461 { return { a461: 1, m461: () => 1 }; }
function c461(): void { say("record/reflect-get/written", ((((Reflect.get(make461(), "m461"))) as any).tag = 1, (((Reflect.get(make461(), "m461"))) as any).tag)); }

interface R462 { a462: number; m462: () => number }
function make462(): R462 { return { a462: 1, m462: () => 1 }; }
function c462(): void { say("record/reflect-get/defined", (Object.defineProperty((Reflect.get(make462(), "m462")) as object, "t", { value: 1 }), "t" in ((Reflect.get(make462(), "m462")) as object))); }

interface R463 { a463: number; m463: () => number }
function make463(): R463 { return { a463: 1, m463: () => 1 }; }
function c463(): void { say("record/reflect-get/frozen", (Object.freeze((Reflect.get(make463(), "m463"))), Object.isFrozen((Reflect.get(make463(), "m463"))))); }

interface R464 { a464: number; m464: () => number }
function make464(): R464 { return { a464: 1, m464: () => 1 }; }
function c464(): void { say("record/reflect-get/prototype-set", (Object.setPrototypeOf((Reflect.get(make464(), "m464")) as object, null), Object.getPrototypeOf((Reflect.get(make464(), "m464"))) === null)); }

interface R465 { a465: number; m465: () => number }
function make465(): R465 { return { a465: 1, m465: () => 1 }; }
function c465(): void { say("record/reflect-get/deleted", (delete (((Reflect.get(make465(), "m465"))) as any).length, Object.hasOwn((Reflect.get(make465(), "m465")) as object, "length"))); }

interface R466 { a466: number; m466: () => number }
function make466(): R466 { return { a466: 1, m466: () => 1 }; }
function same466(a: unknown, b: unknown): boolean { return a === b; }
function c466(): void { say("record/reflect-get/in-a-callee", same466((Reflect.get(make466(), "m466")), (Reflect.get(make466(), "m466")))); }

interface R467 { a467: number; m467: () => number }
function make467(): R467 { return { a467: 1, m467: () => 1 }; }
function hit467(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c467(): void { say("record/reflect-get/switch", hit467((Reflect.get(make467(), "m467")), (Reflect.get(make467(), "m467")))); }

interface R468 { a468: number; m468: () => number }
function make468(): R468 { return { a468: 1, m468: () => 1 }; }
let last468: unknown;
function seen468(f: unknown): boolean { const same = f === last468; last468 = f; return same; }
function c468(): void { say("record/reflect-get/kept-then-compared", (seen468((Reflect.get(make468(), "m468"))), seen468((Reflect.get(make468(), "m468"))))); }

interface R469 { a469: number; m469: () => number }
function make469(): R469 { return { a469: 1, m469: () => 1 }; }
function c469(): void { say("record/spread/strict-eq", (({ ...make469() }).m469) === (({ ...make469() }).m469)); }

interface R470 { a470: number; m470: () => number }
function make470(): R470 { return { a470: 1, m470: () => 1 }; }
function c470(): void { say("record/spread/strict-ne", (({ ...make470() }).m470) !== (({ ...make470() }).m470)); }

interface R471 { a471: number; m471: () => number }
function make471(): R471 { return { a471: 1, m471: () => 1 }; }
function c471(): void { say("record/spread/loose-eq", (({ ...make471() }).m471) == (({ ...make471() }).m471)); }

interface R472 { a472: number; m472: () => number }
function make472(): R472 { return { a472: 1, m472: () => 1 }; }
function c472(): void { say("record/spread/object-is", Object.is((({ ...make472() }).m472), (({ ...make472() }).m472))); }

interface R473 { a473: number; m473: () => number }
function make473(): R473 { return { a473: 1, m473: () => 1 }; }
function c473(): void { say("record/spread/set", new Set([(({ ...make473() }).m473), (({ ...make473() }).m473)]).size); }

interface R474 { a474: number; m474: () => number }
function make474(): R474 { return { a474: 1, m474: () => 1 }; }
function c474(): void { say("record/spread/map-key", new Map([[(({ ...make474() }).m474), 1], [(({ ...make474() }).m474), 2]]).size); }

interface R475 { a475: number; m475: () => number }
function make475(): R475 { return { a475: 1, m475: () => 1 }; }
function c475(): void { say("record/spread/includes", [(({ ...make475() }).m475)].includes((({ ...make475() }).m475))); }

interface R476 { a476: number; m476: () => number }
function make476(): R476 { return { a476: 1, m476: () => 1 }; }
function c476(): void { say("record/spread/index-of", [(({ ...make476() }).m476)].indexOf((({ ...make476() }).m476))); }

interface R477 { a477: number; m477: () => number }
function make477(): R477 { return { a477: 1, m477: () => 1 }; }
const ws477 = new WeakSet<object>();
function c477(): void { say("record/spread/weak-set", (ws477.add((({ ...make477() }).m477) as object), ws477.has((({ ...make477() }).m477) as object))); }

interface R478 { a478: number; m478: () => number }
function make478(): R478 { return { a478: 1, m478: () => 1 }; }
const wm478 = new WeakMap<object, number>();
function c478(): void { say("record/spread/weak-map", (wm478.set((({ ...make478() }).m478) as object, 1), wm478.has((({ ...make478() }).m478) as object))); }

interface R479 { a479: number; m479: () => number }
function make479(): R479 { return { a479: 1, m479: () => 1 }; }
function c479(): void { say("record/spread/written", ((((({ ...make479() }).m479)) as any).tag = 1, (((({ ...make479() }).m479)) as any).tag)); }

interface R480 { a480: number; m480: () => number }
function make480(): R480 { return { a480: 1, m480: () => 1 }; }
function c480(): void { say("record/spread/defined", (Object.defineProperty((({ ...make480() }).m480) as object, "t", { value: 1 }), "t" in ((({ ...make480() }).m480) as object))); }

c421(); c422(); c423(); c424(); c425(); c426(); c427(); c428(); c429(); c430(); c431(); c432(); c433(); c434(); c435(); c436(); c437(); c438(); c439(); c440(); c441(); c442(); c443(); c444(); c445(); c446(); c447(); c448(); c449(); c450(); c451(); c452(); c453(); c454(); c455(); c456(); c457(); c458(); c459(); c460(); c461(); c462(); c463(); c464(); c465(); c466(); c467(); c468(); c469(); c470(); c471(); c472(); c473(); c474(); c475(); c476(); c477(); c478(); c479(); c480();
console.log(out.join("\n"));
