// Generated program: object and closure identity stays observable when allocations are removed (part 6).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R361 { a361: number; m361: () => number }
function make361(): R361 { return { a361: 1, m361: () => 1 }; }
function get361(): unknown { return make361().m361; }
const g361 = [get361];
function c361(): void { say("record/by-value/strict-eq", (g361[0]()) === (g361[0]())); }

interface R362 { a362: number; m362: () => number }
function make362(): R362 { return { a362: 1, m362: () => 1 }; }
function get362(): unknown { return make362().m362; }
const g362 = [get362];
function c362(): void { say("record/by-value/strict-ne", (g362[0]()) !== (g362[0]())); }

interface R363 { a363: number; m363: () => number }
function make363(): R363 { return { a363: 1, m363: () => 1 }; }
function get363(): unknown { return make363().m363; }
const g363 = [get363];
function c363(): void { say("record/by-value/loose-eq", (g363[0]()) == (g363[0]())); }

interface R364 { a364: number; m364: () => number }
function make364(): R364 { return { a364: 1, m364: () => 1 }; }
function get364(): unknown { return make364().m364; }
const g364 = [get364];
function c364(): void { say("record/by-value/object-is", Object.is((g364[0]()), (g364[0]()))); }

interface R365 { a365: number; m365: () => number }
function make365(): R365 { return { a365: 1, m365: () => 1 }; }
function get365(): unknown { return make365().m365; }
const g365 = [get365];
function c365(): void { say("record/by-value/set", new Set([(g365[0]()), (g365[0]())]).size); }

interface R366 { a366: number; m366: () => number }
function make366(): R366 { return { a366: 1, m366: () => 1 }; }
function get366(): unknown { return make366().m366; }
const g366 = [get366];
function c366(): void { say("record/by-value/map-key", new Map([[(g366[0]()), 1], [(g366[0]()), 2]]).size); }

interface R367 { a367: number; m367: () => number }
function make367(): R367 { return { a367: 1, m367: () => 1 }; }
function get367(): unknown { return make367().m367; }
const g367 = [get367];
function c367(): void { say("record/by-value/includes", [(g367[0]())].includes((g367[0]()))); }

interface R368 { a368: number; m368: () => number }
function make368(): R368 { return { a368: 1, m368: () => 1 }; }
function get368(): unknown { return make368().m368; }
const g368 = [get368];
function c368(): void { say("record/by-value/index-of", [(g368[0]())].indexOf((g368[0]()))); }

interface R369 { a369: number; m369: () => number }
function make369(): R369 { return { a369: 1, m369: () => 1 }; }
function get369(): unknown { return make369().m369; }
const g369 = [get369];
const ws369 = new WeakSet<object>();
function c369(): void { say("record/by-value/weak-set", (ws369.add((g369[0]()) as object), ws369.has((g369[0]()) as object))); }

interface R370 { a370: number; m370: () => number }
function make370(): R370 { return { a370: 1, m370: () => 1 }; }
function get370(): unknown { return make370().m370; }
const g370 = [get370];
const wm370 = new WeakMap<object, number>();
function c370(): void { say("record/by-value/weak-map", (wm370.set((g370[0]()) as object, 1), wm370.has((g370[0]()) as object))); }

interface R371 { a371: number; m371: () => number }
function make371(): R371 { return { a371: 1, m371: () => 1 }; }
function get371(): unknown { return make371().m371; }
const g371 = [get371];
function c371(): void { say("record/by-value/written", ((((g371[0]())) as any).tag = 1, (((g371[0]())) as any).tag)); }

interface R372 { a372: number; m372: () => number }
function make372(): R372 { return { a372: 1, m372: () => 1 }; }
function get372(): unknown { return make372().m372; }
const g372 = [get372];
function c372(): void { say("record/by-value/defined", (Object.defineProperty((g372[0]()) as object, "t", { value: 1 }), "t" in ((g372[0]()) as object))); }

interface R373 { a373: number; m373: () => number }
function make373(): R373 { return { a373: 1, m373: () => 1 }; }
function get373(): unknown { return make373().m373; }
const g373 = [get373];
function c373(): void { say("record/by-value/frozen", (Object.freeze((g373[0]())), Object.isFrozen((g373[0]())))); }

interface R374 { a374: number; m374: () => number }
function make374(): R374 { return { a374: 1, m374: () => 1 }; }
function get374(): unknown { return make374().m374; }
const g374 = [get374];
function c374(): void { say("record/by-value/prototype-set", (Object.setPrototypeOf((g374[0]()) as object, null), Object.getPrototypeOf((g374[0]())) === null)); }

interface R375 { a375: number; m375: () => number }
function make375(): R375 { return { a375: 1, m375: () => 1 }; }
function get375(): unknown { return make375().m375; }
const g375 = [get375];
function c375(): void { say("record/by-value/deleted", (delete (((g375[0]())) as any).length, Object.hasOwn((g375[0]()) as object, "length"))); }

interface R376 { a376: number; m376: () => number }
function make376(): R376 { return { a376: 1, m376: () => 1 }; }
function get376(): unknown { return make376().m376; }
const g376 = [get376];
function same376(a: unknown, b: unknown): boolean { return a === b; }
function c376(): void { say("record/by-value/in-a-callee", same376((g376[0]()), (g376[0]()))); }

interface R377 { a377: number; m377: () => number }
function make377(): R377 { return { a377: 1, m377: () => 1 }; }
function get377(): unknown { return make377().m377; }
const g377 = [get377];
function hit377(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c377(): void { say("record/by-value/switch", hit377((g377[0]()), (g377[0]()))); }

interface R378 { a378: number; m378: () => number }
function make378(): R378 { return { a378: 1, m378: () => 1 }; }
function get378(): unknown { return make378().m378; }
const g378 = [get378];
let last378: unknown;
function seen378(f: unknown): boolean { const same = f === last378; last378 = f; return same; }
function c378(): void { say("record/by-value/kept-then-compared", (seen378((g378[0]())), seen378((g378[0]())))); }

interface R379 { a379: number; m379: () => number }
function make379(): R379 { return { a379: 1, m379: () => 1 }; }
function c379(): void { say("record/values/strict-eq", (Object.values(make379())[1]) === (Object.values(make379())[1])); }

interface R380 { a380: number; m380: () => number }
function make380(): R380 { return { a380: 1, m380: () => 1 }; }
function c380(): void { say("record/values/strict-ne", (Object.values(make380())[1]) !== (Object.values(make380())[1])); }

interface R381 { a381: number; m381: () => number }
function make381(): R381 { return { a381: 1, m381: () => 1 }; }
function c381(): void { say("record/values/loose-eq", (Object.values(make381())[1]) == (Object.values(make381())[1])); }

interface R382 { a382: number; m382: () => number }
function make382(): R382 { return { a382: 1, m382: () => 1 }; }
function c382(): void { say("record/values/object-is", Object.is((Object.values(make382())[1]), (Object.values(make382())[1]))); }

interface R383 { a383: number; m383: () => number }
function make383(): R383 { return { a383: 1, m383: () => 1 }; }
function c383(): void { say("record/values/set", new Set([(Object.values(make383())[1]), (Object.values(make383())[1])]).size); }

interface R384 { a384: number; m384: () => number }
function make384(): R384 { return { a384: 1, m384: () => 1 }; }
function c384(): void { say("record/values/map-key", new Map([[(Object.values(make384())[1]), 1], [(Object.values(make384())[1]), 2]]).size); }

interface R385 { a385: number; m385: () => number }
function make385(): R385 { return { a385: 1, m385: () => 1 }; }
function c385(): void { say("record/values/includes", [(Object.values(make385())[1])].includes((Object.values(make385())[1]))); }

interface R386 { a386: number; m386: () => number }
function make386(): R386 { return { a386: 1, m386: () => 1 }; }
function c386(): void { say("record/values/index-of", [(Object.values(make386())[1])].indexOf((Object.values(make386())[1]))); }

interface R387 { a387: number; m387: () => number }
function make387(): R387 { return { a387: 1, m387: () => 1 }; }
const ws387 = new WeakSet<object>();
function c387(): void { say("record/values/weak-set", (ws387.add((Object.values(make387())[1]) as object), ws387.has((Object.values(make387())[1]) as object))); }

interface R388 { a388: number; m388: () => number }
function make388(): R388 { return { a388: 1, m388: () => 1 }; }
const wm388 = new WeakMap<object, number>();
function c388(): void { say("record/values/weak-map", (wm388.set((Object.values(make388())[1]) as object, 1), wm388.has((Object.values(make388())[1]) as object))); }

interface R389 { a389: number; m389: () => number }
function make389(): R389 { return { a389: 1, m389: () => 1 }; }
function c389(): void { say("record/values/written", ((((Object.values(make389())[1])) as any).tag = 1, (((Object.values(make389())[1])) as any).tag)); }

interface R390 { a390: number; m390: () => number }
function make390(): R390 { return { a390: 1, m390: () => 1 }; }
function c390(): void { say("record/values/defined", (Object.defineProperty((Object.values(make390())[1]) as object, "t", { value: 1 }), "t" in ((Object.values(make390())[1]) as object))); }

interface R391 { a391: number; m391: () => number }
function make391(): R391 { return { a391: 1, m391: () => 1 }; }
function c391(): void { say("record/values/frozen", (Object.freeze((Object.values(make391())[1])), Object.isFrozen((Object.values(make391())[1])))); }

interface R392 { a392: number; m392: () => number }
function make392(): R392 { return { a392: 1, m392: () => 1 }; }
function c392(): void { say("record/values/prototype-set", (Object.setPrototypeOf((Object.values(make392())[1]) as object, null), Object.getPrototypeOf((Object.values(make392())[1])) === null)); }

interface R393 { a393: number; m393: () => number }
function make393(): R393 { return { a393: 1, m393: () => 1 }; }
function c393(): void { say("record/values/deleted", (delete (((Object.values(make393())[1])) as any).length, Object.hasOwn((Object.values(make393())[1]) as object, "length"))); }

interface R394 { a394: number; m394: () => number }
function make394(): R394 { return { a394: 1, m394: () => 1 }; }
function same394(a: unknown, b: unknown): boolean { return a === b; }
function c394(): void { say("record/values/in-a-callee", same394((Object.values(make394())[1]), (Object.values(make394())[1]))); }

interface R395 { a395: number; m395: () => number }
function make395(): R395 { return { a395: 1, m395: () => 1 }; }
function hit395(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c395(): void { say("record/values/switch", hit395((Object.values(make395())[1]), (Object.values(make395())[1]))); }

interface R396 { a396: number; m396: () => number }
function make396(): R396 { return { a396: 1, m396: () => 1 }; }
let last396: unknown;
function seen396(f: unknown): boolean { const same = f === last396; last396 = f; return same; }
function c396(): void { say("record/values/kept-then-compared", (seen396((Object.values(make396())[1])), seen396((Object.values(make396())[1])))); }

interface R397 { a397: number; m397: () => number }
function make397(): R397 { return { a397: 1, m397: () => 1 }; }
function get397(): unknown { return Object.values(make397())[1]; }
function c397(): void { say("record/values-returned/strict-eq", (get397()) === (get397())); }

interface R398 { a398: number; m398: () => number }
function make398(): R398 { return { a398: 1, m398: () => 1 }; }
function get398(): unknown { return Object.values(make398())[1]; }
function c398(): void { say("record/values-returned/strict-ne", (get398()) !== (get398())); }

interface R399 { a399: number; m399: () => number }
function make399(): R399 { return { a399: 1, m399: () => 1 }; }
function get399(): unknown { return Object.values(make399())[1]; }
function c399(): void { say("record/values-returned/loose-eq", (get399()) == (get399())); }

interface R400 { a400: number; m400: () => number }
function make400(): R400 { return { a400: 1, m400: () => 1 }; }
function get400(): unknown { return Object.values(make400())[1]; }
function c400(): void { say("record/values-returned/object-is", Object.is((get400()), (get400()))); }

interface R401 { a401: number; m401: () => number }
function make401(): R401 { return { a401: 1, m401: () => 1 }; }
function get401(): unknown { return Object.values(make401())[1]; }
function c401(): void { say("record/values-returned/set", new Set([(get401()), (get401())]).size); }

interface R402 { a402: number; m402: () => number }
function make402(): R402 { return { a402: 1, m402: () => 1 }; }
function get402(): unknown { return Object.values(make402())[1]; }
function c402(): void { say("record/values-returned/map-key", new Map([[(get402()), 1], [(get402()), 2]]).size); }

interface R403 { a403: number; m403: () => number }
function make403(): R403 { return { a403: 1, m403: () => 1 }; }
function get403(): unknown { return Object.values(make403())[1]; }
function c403(): void { say("record/values-returned/includes", [(get403())].includes((get403()))); }

interface R404 { a404: number; m404: () => number }
function make404(): R404 { return { a404: 1, m404: () => 1 }; }
function get404(): unknown { return Object.values(make404())[1]; }
function c404(): void { say("record/values-returned/index-of", [(get404())].indexOf((get404()))); }

interface R405 { a405: number; m405: () => number }
function make405(): R405 { return { a405: 1, m405: () => 1 }; }
function get405(): unknown { return Object.values(make405())[1]; }
const ws405 = new WeakSet<object>();
function c405(): void { say("record/values-returned/weak-set", (ws405.add((get405()) as object), ws405.has((get405()) as object))); }

interface R406 { a406: number; m406: () => number }
function make406(): R406 { return { a406: 1, m406: () => 1 }; }
function get406(): unknown { return Object.values(make406())[1]; }
const wm406 = new WeakMap<object, number>();
function c406(): void { say("record/values-returned/weak-map", (wm406.set((get406()) as object, 1), wm406.has((get406()) as object))); }

interface R407 { a407: number; m407: () => number }
function make407(): R407 { return { a407: 1, m407: () => 1 }; }
function get407(): unknown { return Object.values(make407())[1]; }
function c407(): void { say("record/values-returned/written", ((((get407())) as any).tag = 1, (((get407())) as any).tag)); }

interface R408 { a408: number; m408: () => number }
function make408(): R408 { return { a408: 1, m408: () => 1 }; }
function get408(): unknown { return Object.values(make408())[1]; }
function c408(): void { say("record/values-returned/defined", (Object.defineProperty((get408()) as object, "t", { value: 1 }), "t" in ((get408()) as object))); }

interface R409 { a409: number; m409: () => number }
function make409(): R409 { return { a409: 1, m409: () => 1 }; }
function get409(): unknown { return Object.values(make409())[1]; }
function c409(): void { say("record/values-returned/frozen", (Object.freeze((get409())), Object.isFrozen((get409())))); }

interface R410 { a410: number; m410: () => number }
function make410(): R410 { return { a410: 1, m410: () => 1 }; }
function get410(): unknown { return Object.values(make410())[1]; }
function c410(): void { say("record/values-returned/prototype-set", (Object.setPrototypeOf((get410()) as object, null), Object.getPrototypeOf((get410())) === null)); }

interface R411 { a411: number; m411: () => number }
function make411(): R411 { return { a411: 1, m411: () => 1 }; }
function get411(): unknown { return Object.values(make411())[1]; }
function c411(): void { say("record/values-returned/deleted", (delete (((get411())) as any).length, Object.hasOwn((get411()) as object, "length"))); }

interface R412 { a412: number; m412: () => number }
function make412(): R412 { return { a412: 1, m412: () => 1 }; }
function get412(): unknown { return Object.values(make412())[1]; }
function same412(a: unknown, b: unknown): boolean { return a === b; }
function c412(): void { say("record/values-returned/in-a-callee", same412((get412()), (get412()))); }

interface R413 { a413: number; m413: () => number }
function make413(): R413 { return { a413: 1, m413: () => 1 }; }
function get413(): unknown { return Object.values(make413())[1]; }
function hit413(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c413(): void { say("record/values-returned/switch", hit413((get413()), (get413()))); }

interface R414 { a414: number; m414: () => number }
function make414(): R414 { return { a414: 1, m414: () => 1 }; }
function get414(): unknown { return Object.values(make414())[1]; }
let last414: unknown;
function seen414(f: unknown): boolean { const same = f === last414; last414 = f; return same; }
function c414(): void { say("record/values-returned/kept-then-compared", (seen414((get414())), seen414((get414())))); }

interface R415 { a415: number; m415: () => number }
function make415(): R415 { return { a415: 1, m415: () => 1 }; }
function c415(): void { say("record/entries/strict-eq", (Object.entries(make415())[1][1]) === (Object.entries(make415())[1][1])); }

interface R416 { a416: number; m416: () => number }
function make416(): R416 { return { a416: 1, m416: () => 1 }; }
function c416(): void { say("record/entries/strict-ne", (Object.entries(make416())[1][1]) !== (Object.entries(make416())[1][1])); }

interface R417 { a417: number; m417: () => number }
function make417(): R417 { return { a417: 1, m417: () => 1 }; }
function c417(): void { say("record/entries/loose-eq", (Object.entries(make417())[1][1]) == (Object.entries(make417())[1][1])); }

interface R418 { a418: number; m418: () => number }
function make418(): R418 { return { a418: 1, m418: () => 1 }; }
function c418(): void { say("record/entries/object-is", Object.is((Object.entries(make418())[1][1]), (Object.entries(make418())[1][1]))); }

interface R419 { a419: number; m419: () => number }
function make419(): R419 { return { a419: 1, m419: () => 1 }; }
function c419(): void { say("record/entries/set", new Set([(Object.entries(make419())[1][1]), (Object.entries(make419())[1][1])]).size); }

interface R420 { a420: number; m420: () => number }
function make420(): R420 { return { a420: 1, m420: () => 1 }; }
function c420(): void { say("record/entries/map-key", new Map([[(Object.entries(make420())[1][1]), 1], [(Object.entries(make420())[1][1]), 2]]).size); }

c361(); c362(); c363(); c364(); c365(); c366(); c367(); c368(); c369(); c370(); c371(); c372(); c373(); c374(); c375(); c376(); c377(); c378(); c379(); c380(); c381(); c382(); c383(); c384(); c385(); c386(); c387(); c388(); c389(); c390(); c391(); c392(); c393(); c394(); c395(); c396(); c397(); c398(); c399(); c400(); c401(); c402(); c403(); c404(); c405(); c406(); c407(); c408(); c409(); c410(); c411(); c412(); c413(); c414(); c415(); c416(); c417(); c418(); c419(); c420();
console.log(out.join("\n"));
