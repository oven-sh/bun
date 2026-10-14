// Generated program: object and closure identity stays observable when allocations are removed (part 5).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R301 { a301: number; m301: () => number }
function make301(): R301 { return { a301: 1, m301: () => 1 }; }
function get301(): unknown { try { throw make301().m301; } catch (e) { return e; } }
function c301(): void { say("record/thrown/frozen", (Object.freeze((get301())), Object.isFrozen((get301())))); }

interface R302 { a302: number; m302: () => number }
function make302(): R302 { return { a302: 1, m302: () => 1 }; }
function get302(): unknown { try { throw make302().m302; } catch (e) { return e; } }
function c302(): void { say("record/thrown/prototype-set", (Object.setPrototypeOf((get302()) as object, null), Object.getPrototypeOf((get302())) === null)); }

interface R303 { a303: number; m303: () => number }
function make303(): R303 { return { a303: 1, m303: () => 1 }; }
function get303(): unknown { try { throw make303().m303; } catch (e) { return e; } }
function c303(): void { say("record/thrown/deleted", (delete (((get303())) as any).length, Object.hasOwn((get303()) as object, "length"))); }

interface R304 { a304: number; m304: () => number }
function make304(): R304 { return { a304: 1, m304: () => 1 }; }
function get304(): unknown { try { throw make304().m304; } catch (e) { return e; } }
function same304(a: unknown, b: unknown): boolean { return a === b; }
function c304(): void { say("record/thrown/in-a-callee", same304((get304()), (get304()))); }

interface R305 { a305: number; m305: () => number }
function make305(): R305 { return { a305: 1, m305: () => 1 }; }
function get305(): unknown { try { throw make305().m305; } catch (e) { return e; } }
function hit305(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c305(): void { say("record/thrown/switch", hit305((get305()), (get305()))); }

interface R306 { a306: number; m306: () => number }
function make306(): R306 { return { a306: 1, m306: () => 1 }; }
function get306(): unknown { try { throw make306().m306; } catch (e) { return e; } }
let last306: unknown;
function seen306(f: unknown): boolean { const same = f === last306; last306 = f; return same; }
function c306(): void { say("record/thrown/kept-then-compared", (seen306((get306())), seen306((get306())))); }

interface R307 { a307: number; m307: () => number }
function make307(): R307 { return { a307: 1, m307: () => 1 }; }
function get307(other: unknown, which: boolean): unknown { return which ? make307().m307 : other; }
function c307(): void { say("record/one-arm/strict-eq", (get307(0, true)) === (get307(0, true))); }

interface R308 { a308: number; m308: () => number }
function make308(): R308 { return { a308: 1, m308: () => 1 }; }
function get308(other: unknown, which: boolean): unknown { return which ? make308().m308 : other; }
function c308(): void { say("record/one-arm/strict-ne", (get308(0, true)) !== (get308(0, true))); }

interface R309 { a309: number; m309: () => number }
function make309(): R309 { return { a309: 1, m309: () => 1 }; }
function get309(other: unknown, which: boolean): unknown { return which ? make309().m309 : other; }
function c309(): void { say("record/one-arm/loose-eq", (get309(0, true)) == (get309(0, true))); }

interface R310 { a310: number; m310: () => number }
function make310(): R310 { return { a310: 1, m310: () => 1 }; }
function get310(other: unknown, which: boolean): unknown { return which ? make310().m310 : other; }
function c310(): void { say("record/one-arm/object-is", Object.is((get310(0, true)), (get310(0, true)))); }

interface R311 { a311: number; m311: () => number }
function make311(): R311 { return { a311: 1, m311: () => 1 }; }
function get311(other: unknown, which: boolean): unknown { return which ? make311().m311 : other; }
function c311(): void { say("record/one-arm/set", new Set([(get311(0, true)), (get311(0, true))]).size); }

interface R312 { a312: number; m312: () => number }
function make312(): R312 { return { a312: 1, m312: () => 1 }; }
function get312(other: unknown, which: boolean): unknown { return which ? make312().m312 : other; }
function c312(): void { say("record/one-arm/map-key", new Map([[(get312(0, true)), 1], [(get312(0, true)), 2]]).size); }

interface R313 { a313: number; m313: () => number }
function make313(): R313 { return { a313: 1, m313: () => 1 }; }
function get313(other: unknown, which: boolean): unknown { return which ? make313().m313 : other; }
function c313(): void { say("record/one-arm/includes", [(get313(0, true))].includes((get313(0, true)))); }

interface R314 { a314: number; m314: () => number }
function make314(): R314 { return { a314: 1, m314: () => 1 }; }
function get314(other: unknown, which: boolean): unknown { return which ? make314().m314 : other; }
function c314(): void { say("record/one-arm/index-of", [(get314(0, true))].indexOf((get314(0, true)))); }

interface R315 { a315: number; m315: () => number }
function make315(): R315 { return { a315: 1, m315: () => 1 }; }
function get315(other: unknown, which: boolean): unknown { return which ? make315().m315 : other; }
const ws315 = new WeakSet<object>();
function c315(): void { say("record/one-arm/weak-set", (ws315.add((get315(0, true)) as object), ws315.has((get315(0, true)) as object))); }

interface R316 { a316: number; m316: () => number }
function make316(): R316 { return { a316: 1, m316: () => 1 }; }
function get316(other: unknown, which: boolean): unknown { return which ? make316().m316 : other; }
const wm316 = new WeakMap<object, number>();
function c316(): void { say("record/one-arm/weak-map", (wm316.set((get316(0, true)) as object, 1), wm316.has((get316(0, true)) as object))); }

interface R317 { a317: number; m317: () => number }
function make317(): R317 { return { a317: 1, m317: () => 1 }; }
function get317(other: unknown, which: boolean): unknown { return which ? make317().m317 : other; }
function c317(): void { say("record/one-arm/written", ((((get317(0, true))) as any).tag = 1, (((get317(0, true))) as any).tag)); }

interface R318 { a318: number; m318: () => number }
function make318(): R318 { return { a318: 1, m318: () => 1 }; }
function get318(other: unknown, which: boolean): unknown { return which ? make318().m318 : other; }
function c318(): void { say("record/one-arm/defined", (Object.defineProperty((get318(0, true)) as object, "t", { value: 1 }), "t" in ((get318(0, true)) as object))); }

interface R319 { a319: number; m319: () => number }
function make319(): R319 { return { a319: 1, m319: () => 1 }; }
function get319(other: unknown, which: boolean): unknown { return which ? make319().m319 : other; }
function c319(): void { say("record/one-arm/frozen", (Object.freeze((get319(0, true))), Object.isFrozen((get319(0, true))))); }

interface R320 { a320: number; m320: () => number }
function make320(): R320 { return { a320: 1, m320: () => 1 }; }
function get320(other: unknown, which: boolean): unknown { return which ? make320().m320 : other; }
function c320(): void { say("record/one-arm/prototype-set", (Object.setPrototypeOf((get320(0, true)) as object, null), Object.getPrototypeOf((get320(0, true))) === null)); }

interface R321 { a321: number; m321: () => number }
function make321(): R321 { return { a321: 1, m321: () => 1 }; }
function get321(other: unknown, which: boolean): unknown { return which ? make321().m321 : other; }
function c321(): void { say("record/one-arm/deleted", (delete (((get321(0, true))) as any).length, Object.hasOwn((get321(0, true)) as object, "length"))); }

interface R322 { a322: number; m322: () => number }
function make322(): R322 { return { a322: 1, m322: () => 1 }; }
function get322(other: unknown, which: boolean): unknown { return which ? make322().m322 : other; }
function same322(a: unknown, b: unknown): boolean { return a === b; }
function c322(): void { say("record/one-arm/in-a-callee", same322((get322(0, true)), (get322(0, true)))); }

interface R323 { a323: number; m323: () => number }
function make323(): R323 { return { a323: 1, m323: () => 1 }; }
function get323(other: unknown, which: boolean): unknown { return which ? make323().m323 : other; }
function hit323(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c323(): void { say("record/one-arm/switch", hit323((get323(0, true)), (get323(0, true)))); }

interface R324 { a324: number; m324: () => number }
function make324(): R324 { return { a324: 1, m324: () => 1 }; }
function get324(other: unknown, which: boolean): unknown { return which ? make324().m324 : other; }
let last324: unknown;
function seen324(f: unknown): boolean { const same = f === last324; last324 = f; return same; }
function c324(): void { say("record/one-arm/kept-then-compared", (seen324((get324(0, true))), seen324((get324(0, true))))); }

interface R325 { a325: number; m325: () => number }
function make325(): R325 { return { a325: 1, m325: () => 1 }; }
function get325(): unknown { let t = make325(); for (let i = 0; i < 2; i++) t = make325(); return t.m325; }
function c325(): void { say("record/loop/strict-eq", (get325()) === (get325())); }

interface R326 { a326: number; m326: () => number }
function make326(): R326 { return { a326: 1, m326: () => 1 }; }
function get326(): unknown { let t = make326(); for (let i = 0; i < 2; i++) t = make326(); return t.m326; }
function c326(): void { say("record/loop/strict-ne", (get326()) !== (get326())); }

interface R327 { a327: number; m327: () => number }
function make327(): R327 { return { a327: 1, m327: () => 1 }; }
function get327(): unknown { let t = make327(); for (let i = 0; i < 2; i++) t = make327(); return t.m327; }
function c327(): void { say("record/loop/loose-eq", (get327()) == (get327())); }

interface R328 { a328: number; m328: () => number }
function make328(): R328 { return { a328: 1, m328: () => 1 }; }
function get328(): unknown { let t = make328(); for (let i = 0; i < 2; i++) t = make328(); return t.m328; }
function c328(): void { say("record/loop/object-is", Object.is((get328()), (get328()))); }

interface R329 { a329: number; m329: () => number }
function make329(): R329 { return { a329: 1, m329: () => 1 }; }
function get329(): unknown { let t = make329(); for (let i = 0; i < 2; i++) t = make329(); return t.m329; }
function c329(): void { say("record/loop/set", new Set([(get329()), (get329())]).size); }

interface R330 { a330: number; m330: () => number }
function make330(): R330 { return { a330: 1, m330: () => 1 }; }
function get330(): unknown { let t = make330(); for (let i = 0; i < 2; i++) t = make330(); return t.m330; }
function c330(): void { say("record/loop/map-key", new Map([[(get330()), 1], [(get330()), 2]]).size); }

interface R331 { a331: number; m331: () => number }
function make331(): R331 { return { a331: 1, m331: () => 1 }; }
function get331(): unknown { let t = make331(); for (let i = 0; i < 2; i++) t = make331(); return t.m331; }
function c331(): void { say("record/loop/includes", [(get331())].includes((get331()))); }

interface R332 { a332: number; m332: () => number }
function make332(): R332 { return { a332: 1, m332: () => 1 }; }
function get332(): unknown { let t = make332(); for (let i = 0; i < 2; i++) t = make332(); return t.m332; }
function c332(): void { say("record/loop/index-of", [(get332())].indexOf((get332()))); }

interface R333 { a333: number; m333: () => number }
function make333(): R333 { return { a333: 1, m333: () => 1 }; }
function get333(): unknown { let t = make333(); for (let i = 0; i < 2; i++) t = make333(); return t.m333; }
const ws333 = new WeakSet<object>();
function c333(): void { say("record/loop/weak-set", (ws333.add((get333()) as object), ws333.has((get333()) as object))); }

interface R334 { a334: number; m334: () => number }
function make334(): R334 { return { a334: 1, m334: () => 1 }; }
function get334(): unknown { let t = make334(); for (let i = 0; i < 2; i++) t = make334(); return t.m334; }
const wm334 = new WeakMap<object, number>();
function c334(): void { say("record/loop/weak-map", (wm334.set((get334()) as object, 1), wm334.has((get334()) as object))); }

interface R335 { a335: number; m335: () => number }
function make335(): R335 { return { a335: 1, m335: () => 1 }; }
function get335(): unknown { let t = make335(); for (let i = 0; i < 2; i++) t = make335(); return t.m335; }
function c335(): void { say("record/loop/written", ((((get335())) as any).tag = 1, (((get335())) as any).tag)); }

interface R336 { a336: number; m336: () => number }
function make336(): R336 { return { a336: 1, m336: () => 1 }; }
function get336(): unknown { let t = make336(); for (let i = 0; i < 2; i++) t = make336(); return t.m336; }
function c336(): void { say("record/loop/defined", (Object.defineProperty((get336()) as object, "t", { value: 1 }), "t" in ((get336()) as object))); }

interface R337 { a337: number; m337: () => number }
function make337(): R337 { return { a337: 1, m337: () => 1 }; }
function get337(): unknown { let t = make337(); for (let i = 0; i < 2; i++) t = make337(); return t.m337; }
function c337(): void { say("record/loop/frozen", (Object.freeze((get337())), Object.isFrozen((get337())))); }

interface R338 { a338: number; m338: () => number }
function make338(): R338 { return { a338: 1, m338: () => 1 }; }
function get338(): unknown { let t = make338(); for (let i = 0; i < 2; i++) t = make338(); return t.m338; }
function c338(): void { say("record/loop/prototype-set", (Object.setPrototypeOf((get338()) as object, null), Object.getPrototypeOf((get338())) === null)); }

interface R339 { a339: number; m339: () => number }
function make339(): R339 { return { a339: 1, m339: () => 1 }; }
function get339(): unknown { let t = make339(); for (let i = 0; i < 2; i++) t = make339(); return t.m339; }
function c339(): void { say("record/loop/deleted", (delete (((get339())) as any).length, Object.hasOwn((get339()) as object, "length"))); }

interface R340 { a340: number; m340: () => number }
function make340(): R340 { return { a340: 1, m340: () => 1 }; }
function get340(): unknown { let t = make340(); for (let i = 0; i < 2; i++) t = make340(); return t.m340; }
function same340(a: unknown, b: unknown): boolean { return a === b; }
function c340(): void { say("record/loop/in-a-callee", same340((get340()), (get340()))); }

interface R341 { a341: number; m341: () => number }
function make341(): R341 { return { a341: 1, m341: () => 1 }; }
function get341(): unknown { let t = make341(); for (let i = 0; i < 2; i++) t = make341(); return t.m341; }
function hit341(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c341(): void { say("record/loop/switch", hit341((get341()), (get341()))); }

interface R342 { a342: number; m342: () => number }
function make342(): R342 { return { a342: 1, m342: () => 1 }; }
function get342(): unknown { let t = make342(); for (let i = 0; i < 2; i++) t = make342(); return t.m342; }
let last342: unknown;
function seen342(f: unknown): boolean { const same = f === last342; last342 = f; return same; }
function c342(): void { say("record/loop/kept-then-compared", (seen342((get342())), seen342((get342())))); }

interface R343 { a343: number; m343: () => number }
function make343(): R343 { return { a343: 1, m343: () => 1 }; }
function id343<T>(x: T): T { return x; }
function get343(): unknown { return id343(make343()).m343; }
function c343(): void { say("record/identity/strict-eq", (get343()) === (get343())); }

interface R344 { a344: number; m344: () => number }
function make344(): R344 { return { a344: 1, m344: () => 1 }; }
function id344<T>(x: T): T { return x; }
function get344(): unknown { return id344(make344()).m344; }
function c344(): void { say("record/identity/strict-ne", (get344()) !== (get344())); }

interface R345 { a345: number; m345: () => number }
function make345(): R345 { return { a345: 1, m345: () => 1 }; }
function id345<T>(x: T): T { return x; }
function get345(): unknown { return id345(make345()).m345; }
function c345(): void { say("record/identity/loose-eq", (get345()) == (get345())); }

interface R346 { a346: number; m346: () => number }
function make346(): R346 { return { a346: 1, m346: () => 1 }; }
function id346<T>(x: T): T { return x; }
function get346(): unknown { return id346(make346()).m346; }
function c346(): void { say("record/identity/object-is", Object.is((get346()), (get346()))); }

interface R347 { a347: number; m347: () => number }
function make347(): R347 { return { a347: 1, m347: () => 1 }; }
function id347<T>(x: T): T { return x; }
function get347(): unknown { return id347(make347()).m347; }
function c347(): void { say("record/identity/set", new Set([(get347()), (get347())]).size); }

interface R348 { a348: number; m348: () => number }
function make348(): R348 { return { a348: 1, m348: () => 1 }; }
function id348<T>(x: T): T { return x; }
function get348(): unknown { return id348(make348()).m348; }
function c348(): void { say("record/identity/map-key", new Map([[(get348()), 1], [(get348()), 2]]).size); }

interface R349 { a349: number; m349: () => number }
function make349(): R349 { return { a349: 1, m349: () => 1 }; }
function id349<T>(x: T): T { return x; }
function get349(): unknown { return id349(make349()).m349; }
function c349(): void { say("record/identity/includes", [(get349())].includes((get349()))); }

interface R350 { a350: number; m350: () => number }
function make350(): R350 { return { a350: 1, m350: () => 1 }; }
function id350<T>(x: T): T { return x; }
function get350(): unknown { return id350(make350()).m350; }
function c350(): void { say("record/identity/index-of", [(get350())].indexOf((get350()))); }

interface R351 { a351: number; m351: () => number }
function make351(): R351 { return { a351: 1, m351: () => 1 }; }
function id351<T>(x: T): T { return x; }
function get351(): unknown { return id351(make351()).m351; }
const ws351 = new WeakSet<object>();
function c351(): void { say("record/identity/weak-set", (ws351.add((get351()) as object), ws351.has((get351()) as object))); }

interface R352 { a352: number; m352: () => number }
function make352(): R352 { return { a352: 1, m352: () => 1 }; }
function id352<T>(x: T): T { return x; }
function get352(): unknown { return id352(make352()).m352; }
const wm352 = new WeakMap<object, number>();
function c352(): void { say("record/identity/weak-map", (wm352.set((get352()) as object, 1), wm352.has((get352()) as object))); }

interface R353 { a353: number; m353: () => number }
function make353(): R353 { return { a353: 1, m353: () => 1 }; }
function id353<T>(x: T): T { return x; }
function get353(): unknown { return id353(make353()).m353; }
function c353(): void { say("record/identity/written", ((((get353())) as any).tag = 1, (((get353())) as any).tag)); }

interface R354 { a354: number; m354: () => number }
function make354(): R354 { return { a354: 1, m354: () => 1 }; }
function id354<T>(x: T): T { return x; }
function get354(): unknown { return id354(make354()).m354; }
function c354(): void { say("record/identity/defined", (Object.defineProperty((get354()) as object, "t", { value: 1 }), "t" in ((get354()) as object))); }

interface R355 { a355: number; m355: () => number }
function make355(): R355 { return { a355: 1, m355: () => 1 }; }
function id355<T>(x: T): T { return x; }
function get355(): unknown { return id355(make355()).m355; }
function c355(): void { say("record/identity/frozen", (Object.freeze((get355())), Object.isFrozen((get355())))); }

interface R356 { a356: number; m356: () => number }
function make356(): R356 { return { a356: 1, m356: () => 1 }; }
function id356<T>(x: T): T { return x; }
function get356(): unknown { return id356(make356()).m356; }
function c356(): void { say("record/identity/prototype-set", (Object.setPrototypeOf((get356()) as object, null), Object.getPrototypeOf((get356())) === null)); }

interface R357 { a357: number; m357: () => number }
function make357(): R357 { return { a357: 1, m357: () => 1 }; }
function id357<T>(x: T): T { return x; }
function get357(): unknown { return id357(make357()).m357; }
function c357(): void { say("record/identity/deleted", (delete (((get357())) as any).length, Object.hasOwn((get357()) as object, "length"))); }

interface R358 { a358: number; m358: () => number }
function make358(): R358 { return { a358: 1, m358: () => 1 }; }
function id358<T>(x: T): T { return x; }
function get358(): unknown { return id358(make358()).m358; }
function same358(a: unknown, b: unknown): boolean { return a === b; }
function c358(): void { say("record/identity/in-a-callee", same358((get358()), (get358()))); }

interface R359 { a359: number; m359: () => number }
function make359(): R359 { return { a359: 1, m359: () => 1 }; }
function id359<T>(x: T): T { return x; }
function get359(): unknown { return id359(make359()).m359; }
function hit359(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c359(): void { say("record/identity/switch", hit359((get359()), (get359()))); }

interface R360 { a360: number; m360: () => number }
function make360(): R360 { return { a360: 1, m360: () => 1 }; }
function id360<T>(x: T): T { return x; }
function get360(): unknown { return id360(make360()).m360; }
let last360: unknown;
function seen360(f: unknown): boolean { const same = f === last360; last360 = f; return same; }
function c360(): void { say("record/identity/kept-then-compared", (seen360((get360())), seen360((get360())))); }

c301(); c302(); c303(); c304(); c305(); c306(); c307(); c308(); c309(); c310(); c311(); c312(); c313(); c314(); c315(); c316(); c317(); c318(); c319(); c320(); c321(); c322(); c323(); c324(); c325(); c326(); c327(); c328(); c329(); c330(); c331(); c332(); c333(); c334(); c335(); c336(); c337(); c338(); c339(); c340(); c341(); c342(); c343(); c344(); c345(); c346(); c347(); c348(); c349(); c350(); c351(); c352(); c353(); c354(); c355(); c356(); c357(); c358(); c359(); c360();
console.log(out.join("\n"));
