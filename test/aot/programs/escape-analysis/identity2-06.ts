// Generated program: object and closure identity stays observable when allocations are removed (second series, part 6).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R361 { a361: number; m361: () => number }
function make361(): R361 { return { a361: 1, m361: () => 1 }; }
function c361(): void { say("record/concat/strict-eq", (([] as unknown[]).concat([make361().m361])[0]) === (([] as unknown[]).concat([make361().m361])[0])); }

interface R362 { a362: number; m362: () => number }
function make362(): R362 { return { a362: 1, m362: () => 1 }; }
function c362(): void { say("record/concat/strict-ne", (([] as unknown[]).concat([make362().m362])[0]) !== (([] as unknown[]).concat([make362().m362])[0])); }

interface R363 { a363: number; m363: () => number }
function make363(): R363 { return { a363: 1, m363: () => 1 }; }
function c363(): void { say("record/concat/loose-eq", (([] as unknown[]).concat([make363().m363])[0]) == (([] as unknown[]).concat([make363().m363])[0])); }

interface R364 { a364: number; m364: () => number }
function make364(): R364 { return { a364: 1, m364: () => 1 }; }
function c364(): void { say("record/concat/object-is", Object.is((([] as unknown[]).concat([make364().m364])[0]), (([] as unknown[]).concat([make364().m364])[0]))); }

interface R365 { a365: number; m365: () => number }
function make365(): R365 { return { a365: 1, m365: () => 1 }; }
function c365(): void { say("record/concat/set", new Set([(([] as unknown[]).concat([make365().m365])[0]), (([] as unknown[]).concat([make365().m365])[0])]).size); }

interface R366 { a366: number; m366: () => number }
function make366(): R366 { return { a366: 1, m366: () => 1 }; }
function c366(): void { say("record/concat/map-key", new Map([[(([] as unknown[]).concat([make366().m366])[0]), 1], [(([] as unknown[]).concat([make366().m366])[0]), 2]]).size); }

interface R367 { a367: number; m367: () => number }
function make367(): R367 { return { a367: 1, m367: () => 1 }; }
function c367(): void { say("record/concat/includes", [(([] as unknown[]).concat([make367().m367])[0])].includes((([] as unknown[]).concat([make367().m367])[0]))); }

interface R368 { a368: number; m368: () => number }
function make368(): R368 { return { a368: 1, m368: () => 1 }; }
function c368(): void { say("record/concat/index-of", [(([] as unknown[]).concat([make368().m368])[0])].indexOf((([] as unknown[]).concat([make368().m368])[0]))); }

interface R369 { a369: number; m369: () => number }
function make369(): R369 { return { a369: 1, m369: () => 1 }; }
const ws369 = new WeakSet<object>();
function c369(): void { say("record/concat/weak-set", (ws369.add((([] as unknown[]).concat([make369().m369])[0]) as object), ws369.has((([] as unknown[]).concat([make369().m369])[0]) as object))); }

interface R370 { a370: number; m370: () => number }
function make370(): R370 { return { a370: 1, m370: () => 1 }; }
const wm370 = new WeakMap<object, number>();
function c370(): void { say("record/concat/weak-map", (wm370.set((([] as unknown[]).concat([make370().m370])[0]) as object, 1), wm370.has((([] as unknown[]).concat([make370().m370])[0]) as object))); }

interface R371 { a371: number; m371: () => number }
function make371(): R371 { return { a371: 1, m371: () => 1 }; }
function c371(): void { say("record/concat/written", ((((([] as unknown[]).concat([make371().m371])[0])) as any).tag = 1, (((([] as unknown[]).concat([make371().m371])[0])) as any).tag)); }

interface R372 { a372: number; m372: () => number }
function make372(): R372 { return { a372: 1, m372: () => 1 }; }
function c372(): void { say("record/concat/defined", (Object.defineProperty((([] as unknown[]).concat([make372().m372])[0]) as object, "t", { value: 1 }), "t" in ((([] as unknown[]).concat([make372().m372])[0]) as object))); }

interface R373 { a373: number; m373: () => number }
function make373(): R373 { return { a373: 1, m373: () => 1 }; }
function c373(): void { say("record/concat/frozen", (Object.freeze((([] as unknown[]).concat([make373().m373])[0])), Object.isFrozen((([] as unknown[]).concat([make373().m373])[0])))); }

interface R374 { a374: number; m374: () => number }
function make374(): R374 { return { a374: 1, m374: () => 1 }; }
function c374(): void { say("record/concat/prototype-set", (Object.setPrototypeOf((([] as unknown[]).concat([make374().m374])[0]) as object, null), Object.getPrototypeOf((([] as unknown[]).concat([make374().m374])[0])) === null)); }

interface R375 { a375: number; m375: () => number }
function make375(): R375 { return { a375: 1, m375: () => 1 }; }
function c375(): void { say("record/concat/deleted", (delete (((([] as unknown[]).concat([make375().m375])[0])) as any).length, Object.hasOwn((([] as unknown[]).concat([make375().m375])[0]) as object, "length"))); }

interface R376 { a376: number; m376: () => number }
function make376(): R376 { return { a376: 1, m376: () => 1 }; }
function same376(a: unknown, b: unknown): boolean { return a === b; }
function c376(): void { say("record/concat/in-a-callee", same376((([] as unknown[]).concat([make376().m376])[0]), (([] as unknown[]).concat([make376().m376])[0]))); }

interface R377 { a377: number; m377: () => number }
function make377(): R377 { return { a377: 1, m377: () => 1 }; }
function hit377(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c377(): void { say("record/concat/switch", hit377((([] as unknown[]).concat([make377().m377])[0]), (([] as unknown[]).concat([make377().m377])[0]))); }

interface R378 { a378: number; m378: () => number }
function make378(): R378 { return { a378: 1, m378: () => 1 }; }
let last378: unknown;
function seen378(f: unknown): boolean { const same = f === last378; last378 = f; return same; }
function c378(): void { say("record/concat/kept-then-compared", (seen378((([] as unknown[]).concat([make378().m378])[0])), seen378((([] as unknown[]).concat([make378().m378])[0])))); }

interface R379 { a379: number; m379: () => number }
function make379(): R379 { return { a379: 1, m379: () => 1 }; }
function c379(): void { say("record/spread-array/strict-eq", ([...[make379().m379]][0]) === ([...[make379().m379]][0])); }

interface R380 { a380: number; m380: () => number }
function make380(): R380 { return { a380: 1, m380: () => 1 }; }
function c380(): void { say("record/spread-array/strict-ne", ([...[make380().m380]][0]) !== ([...[make380().m380]][0])); }

interface R381 { a381: number; m381: () => number }
function make381(): R381 { return { a381: 1, m381: () => 1 }; }
function c381(): void { say("record/spread-array/loose-eq", ([...[make381().m381]][0]) == ([...[make381().m381]][0])); }

interface R382 { a382: number; m382: () => number }
function make382(): R382 { return { a382: 1, m382: () => 1 }; }
function c382(): void { say("record/spread-array/object-is", Object.is(([...[make382().m382]][0]), ([...[make382().m382]][0]))); }

interface R383 { a383: number; m383: () => number }
function make383(): R383 { return { a383: 1, m383: () => 1 }; }
function c383(): void { say("record/spread-array/set", new Set([([...[make383().m383]][0]), ([...[make383().m383]][0])]).size); }

interface R384 { a384: number; m384: () => number }
function make384(): R384 { return { a384: 1, m384: () => 1 }; }
function c384(): void { say("record/spread-array/map-key", new Map([[([...[make384().m384]][0]), 1], [([...[make384().m384]][0]), 2]]).size); }

interface R385 { a385: number; m385: () => number }
function make385(): R385 { return { a385: 1, m385: () => 1 }; }
function c385(): void { say("record/spread-array/includes", [([...[make385().m385]][0])].includes(([...[make385().m385]][0]))); }

interface R386 { a386: number; m386: () => number }
function make386(): R386 { return { a386: 1, m386: () => 1 }; }
function c386(): void { say("record/spread-array/index-of", [([...[make386().m386]][0])].indexOf(([...[make386().m386]][0]))); }

interface R387 { a387: number; m387: () => number }
function make387(): R387 { return { a387: 1, m387: () => 1 }; }
const ws387 = new WeakSet<object>();
function c387(): void { say("record/spread-array/weak-set", (ws387.add(([...[make387().m387]][0]) as object), ws387.has(([...[make387().m387]][0]) as object))); }

interface R388 { a388: number; m388: () => number }
function make388(): R388 { return { a388: 1, m388: () => 1 }; }
const wm388 = new WeakMap<object, number>();
function c388(): void { say("record/spread-array/weak-map", (wm388.set(([...[make388().m388]][0]) as object, 1), wm388.has(([...[make388().m388]][0]) as object))); }

interface R389 { a389: number; m389: () => number }
function make389(): R389 { return { a389: 1, m389: () => 1 }; }
function c389(): void { say("record/spread-array/written", (((([...[make389().m389]][0])) as any).tag = 1, ((([...[make389().m389]][0])) as any).tag)); }

interface R390 { a390: number; m390: () => number }
function make390(): R390 { return { a390: 1, m390: () => 1 }; }
function c390(): void { say("record/spread-array/defined", (Object.defineProperty(([...[make390().m390]][0]) as object, "t", { value: 1 }), "t" in (([...[make390().m390]][0]) as object))); }

interface R391 { a391: number; m391: () => number }
function make391(): R391 { return { a391: 1, m391: () => 1 }; }
function c391(): void { say("record/spread-array/frozen", (Object.freeze(([...[make391().m391]][0])), Object.isFrozen(([...[make391().m391]][0])))); }

interface R392 { a392: number; m392: () => number }
function make392(): R392 { return { a392: 1, m392: () => 1 }; }
function c392(): void { say("record/spread-array/prototype-set", (Object.setPrototypeOf(([...[make392().m392]][0]) as object, null), Object.getPrototypeOf(([...[make392().m392]][0])) === null)); }

interface R393 { a393: number; m393: () => number }
function make393(): R393 { return { a393: 1, m393: () => 1 }; }
function c393(): void { say("record/spread-array/deleted", (delete ((([...[make393().m393]][0])) as any).length, Object.hasOwn(([...[make393().m393]][0]) as object, "length"))); }

interface R394 { a394: number; m394: () => number }
function make394(): R394 { return { a394: 1, m394: () => 1 }; }
function same394(a: unknown, b: unknown): boolean { return a === b; }
function c394(): void { say("record/spread-array/in-a-callee", same394(([...[make394().m394]][0]), ([...[make394().m394]][0]))); }

interface R395 { a395: number; m395: () => number }
function make395(): R395 { return { a395: 1, m395: () => 1 }; }
function hit395(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c395(): void { say("record/spread-array/switch", hit395(([...[make395().m395]][0]), ([...[make395().m395]][0]))); }

interface R396 { a396: number; m396: () => number }
function make396(): R396 { return { a396: 1, m396: () => 1 }; }
let last396: unknown;
function seen396(f: unknown): boolean { const same = f === last396; last396 = f; return same; }
function c396(): void { say("record/spread-array/kept-then-compared", (seen396(([...[make396().m396]][0])), seen396(([...[make396().m396]][0])))); }

interface R397 { a397: number; m397: () => number }
function make397(): R397 { return { a397: 1, m397: () => 1 }; }
function c397(): void { say("record/array-from/strict-eq", (Array.from([make397().m397])[0]) === (Array.from([make397().m397])[0])); }

interface R398 { a398: number; m398: () => number }
function make398(): R398 { return { a398: 1, m398: () => 1 }; }
function c398(): void { say("record/array-from/strict-ne", (Array.from([make398().m398])[0]) !== (Array.from([make398().m398])[0])); }

interface R399 { a399: number; m399: () => number }
function make399(): R399 { return { a399: 1, m399: () => 1 }; }
function c399(): void { say("record/array-from/loose-eq", (Array.from([make399().m399])[0]) == (Array.from([make399().m399])[0])); }

interface R400 { a400: number; m400: () => number }
function make400(): R400 { return { a400: 1, m400: () => 1 }; }
function c400(): void { say("record/array-from/object-is", Object.is((Array.from([make400().m400])[0]), (Array.from([make400().m400])[0]))); }

interface R401 { a401: number; m401: () => number }
function make401(): R401 { return { a401: 1, m401: () => 1 }; }
function c401(): void { say("record/array-from/set", new Set([(Array.from([make401().m401])[0]), (Array.from([make401().m401])[0])]).size); }

interface R402 { a402: number; m402: () => number }
function make402(): R402 { return { a402: 1, m402: () => 1 }; }
function c402(): void { say("record/array-from/map-key", new Map([[(Array.from([make402().m402])[0]), 1], [(Array.from([make402().m402])[0]), 2]]).size); }

interface R403 { a403: number; m403: () => number }
function make403(): R403 { return { a403: 1, m403: () => 1 }; }
function c403(): void { say("record/array-from/includes", [(Array.from([make403().m403])[0])].includes((Array.from([make403().m403])[0]))); }

interface R404 { a404: number; m404: () => number }
function make404(): R404 { return { a404: 1, m404: () => 1 }; }
function c404(): void { say("record/array-from/index-of", [(Array.from([make404().m404])[0])].indexOf((Array.from([make404().m404])[0]))); }

interface R405 { a405: number; m405: () => number }
function make405(): R405 { return { a405: 1, m405: () => 1 }; }
const ws405 = new WeakSet<object>();
function c405(): void { say("record/array-from/weak-set", (ws405.add((Array.from([make405().m405])[0]) as object), ws405.has((Array.from([make405().m405])[0]) as object))); }

interface R406 { a406: number; m406: () => number }
function make406(): R406 { return { a406: 1, m406: () => 1 }; }
const wm406 = new WeakMap<object, number>();
function c406(): void { say("record/array-from/weak-map", (wm406.set((Array.from([make406().m406])[0]) as object, 1), wm406.has((Array.from([make406().m406])[0]) as object))); }

interface R407 { a407: number; m407: () => number }
function make407(): R407 { return { a407: 1, m407: () => 1 }; }
function c407(): void { say("record/array-from/written", ((((Array.from([make407().m407])[0])) as any).tag = 1, (((Array.from([make407().m407])[0])) as any).tag)); }

interface R408 { a408: number; m408: () => number }
function make408(): R408 { return { a408: 1, m408: () => 1 }; }
function c408(): void { say("record/array-from/defined", (Object.defineProperty((Array.from([make408().m408])[0]) as object, "t", { value: 1 }), "t" in ((Array.from([make408().m408])[0]) as object))); }

interface R409 { a409: number; m409: () => number }
function make409(): R409 { return { a409: 1, m409: () => 1 }; }
function c409(): void { say("record/array-from/frozen", (Object.freeze((Array.from([make409().m409])[0])), Object.isFrozen((Array.from([make409().m409])[0])))); }

interface R410 { a410: number; m410: () => number }
function make410(): R410 { return { a410: 1, m410: () => 1 }; }
function c410(): void { say("record/array-from/prototype-set", (Object.setPrototypeOf((Array.from([make410().m410])[0]) as object, null), Object.getPrototypeOf((Array.from([make410().m410])[0])) === null)); }

interface R411 { a411: number; m411: () => number }
function make411(): R411 { return { a411: 1, m411: () => 1 }; }
function c411(): void { say("record/array-from/deleted", (delete (((Array.from([make411().m411])[0])) as any).length, Object.hasOwn((Array.from([make411().m411])[0]) as object, "length"))); }

interface R412 { a412: number; m412: () => number }
function make412(): R412 { return { a412: 1, m412: () => 1 }; }
function same412(a: unknown, b: unknown): boolean { return a === b; }
function c412(): void { say("record/array-from/in-a-callee", same412((Array.from([make412().m412])[0]), (Array.from([make412().m412])[0]))); }

interface R413 { a413: number; m413: () => number }
function make413(): R413 { return { a413: 1, m413: () => 1 }; }
function hit413(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c413(): void { say("record/array-from/switch", hit413((Array.from([make413().m413])[0]), (Array.from([make413().m413])[0]))); }

interface R414 { a414: number; m414: () => number }
function make414(): R414 { return { a414: 1, m414: () => 1 }; }
let last414: unknown;
function seen414(f: unknown): boolean { const same = f === last414; last414 = f; return same; }
function c414(): void { say("record/array-from/kept-then-compared", (seen414((Array.from([make414().m414])[0])), seen414((Array.from([make414().m414])[0])))); }

interface R415 { a415: number; m415: () => number }
function make415(): R415 { return { a415: 1, m415: () => 1 }; }
function c415(): void { say("record/array-of/strict-eq", (Array.of(make415().m415)[0]) === (Array.of(make415().m415)[0])); }

interface R416 { a416: number; m416: () => number }
function make416(): R416 { return { a416: 1, m416: () => 1 }; }
function c416(): void { say("record/array-of/strict-ne", (Array.of(make416().m416)[0]) !== (Array.of(make416().m416)[0])); }

interface R417 { a417: number; m417: () => number }
function make417(): R417 { return { a417: 1, m417: () => 1 }; }
function c417(): void { say("record/array-of/loose-eq", (Array.of(make417().m417)[0]) == (Array.of(make417().m417)[0])); }

interface R418 { a418: number; m418: () => number }
function make418(): R418 { return { a418: 1, m418: () => 1 }; }
function c418(): void { say("record/array-of/object-is", Object.is((Array.of(make418().m418)[0]), (Array.of(make418().m418)[0]))); }

interface R419 { a419: number; m419: () => number }
function make419(): R419 { return { a419: 1, m419: () => 1 }; }
function c419(): void { say("record/array-of/set", new Set([(Array.of(make419().m419)[0]), (Array.of(make419().m419)[0])]).size); }

interface R420 { a420: number; m420: () => number }
function make420(): R420 { return { a420: 1, m420: () => 1 }; }
function c420(): void { say("record/array-of/map-key", new Map([[(Array.of(make420().m420)[0]), 1], [(Array.of(make420().m420)[0]), 2]]).size); }

c361(); c362(); c363(); c364(); c365(); c366(); c367(); c368(); c369(); c370(); c371(); c372(); c373(); c374(); c375(); c376(); c377(); c378(); c379(); c380(); c381(); c382(); c383(); c384(); c385(); c386(); c387(); c388(); c389(); c390(); c391(); c392(); c393(); c394(); c395(); c396(); c397(); c398(); c399(); c400(); c401(); c402(); c403(); c404(); c405(); c406(); c407(); c408(); c409(); c410(); c411(); c412(); c413(); c414(); c415(); c416(); c417(); c418(); c419(); c420();
console.log(out.join("\n"));
