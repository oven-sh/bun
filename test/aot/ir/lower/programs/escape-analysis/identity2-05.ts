// RUN: lower
// OPTIONS: builtin-modules

// Generated program: object and closure identity stays observable when allocations are removed (second series, part 5).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R301 { a301: number; m301: () => number }
function make301(): R301 { return { a301: 1, m301: () => 1 }; }
function c301(): void { say("record/at/frozen", (Object.freeze(([make301().m301].at(0))), Object.isFrozen(([make301().m301].at(0))))); }

interface R302 { a302: number; m302: () => number }
function make302(): R302 { return { a302: 1, m302: () => 1 }; }
function c302(): void { say("record/at/prototype-set", (Object.setPrototypeOf(([make302().m302].at(0)) as object, null), Object.getPrototypeOf(([make302().m302].at(0))) === null)); }

interface R303 { a303: number; m303: () => number }
function make303(): R303 { return { a303: 1, m303: () => 1 }; }
function c303(): void { say("record/at/deleted", (delete ((([make303().m303].at(0))) as any).length, Object.hasOwn(([make303().m303].at(0)) as object, "length"))); }

interface R304 { a304: number; m304: () => number }
function make304(): R304 { return { a304: 1, m304: () => 1 }; }
function same304(a: unknown, b: unknown): boolean { return a === b; }
function c304(): void { say("record/at/in-a-callee", same304(([make304().m304].at(0)), ([make304().m304].at(0)))); }

interface R305 { a305: number; m305: () => number }
function make305(): R305 { return { a305: 1, m305: () => 1 }; }
function hit305(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c305(): void { say("record/at/switch", hit305(([make305().m305].at(0)), ([make305().m305].at(0)))); }

interface R306 { a306: number; m306: () => number }
function make306(): R306 { return { a306: 1, m306: () => 1 }; }
let last306: unknown;
function seen306(f: unknown): boolean { const same = f === last306; last306 = f; return same; }
function c306(): void { say("record/at/kept-then-compared", (seen306(([make306().m306].at(0))), seen306(([make306().m306].at(0))))); }

interface R307 { a307: number; m307: () => number }
function make307(): R307 { return { a307: 1, m307: () => 1 }; }
function c307(): void { say("record/pop/strict-eq", ([make307().m307].pop()) === ([make307().m307].pop())); }

interface R308 { a308: number; m308: () => number }
function make308(): R308 { return { a308: 1, m308: () => 1 }; }
function c308(): void { say("record/pop/strict-ne", ([make308().m308].pop()) !== ([make308().m308].pop())); }

interface R309 { a309: number; m309: () => number }
function make309(): R309 { return { a309: 1, m309: () => 1 }; }
function c309(): void { say("record/pop/loose-eq", ([make309().m309].pop()) == ([make309().m309].pop())); }

interface R310 { a310: number; m310: () => number }
function make310(): R310 { return { a310: 1, m310: () => 1 }; }
function c310(): void { say("record/pop/object-is", Object.is(([make310().m310].pop()), ([make310().m310].pop()))); }

interface R311 { a311: number; m311: () => number }
function make311(): R311 { return { a311: 1, m311: () => 1 }; }
function c311(): void { say("record/pop/set", new Set([([make311().m311].pop()), ([make311().m311].pop())]).size); }

interface R312 { a312: number; m312: () => number }
function make312(): R312 { return { a312: 1, m312: () => 1 }; }
function c312(): void { say("record/pop/map-key", new Map([[([make312().m312].pop()), 1], [([make312().m312].pop()), 2]]).size); }

interface R313 { a313: number; m313: () => number }
function make313(): R313 { return { a313: 1, m313: () => 1 }; }
function c313(): void { say("record/pop/includes", [([make313().m313].pop())].includes(([make313().m313].pop()))); }

interface R314 { a314: number; m314: () => number }
function make314(): R314 { return { a314: 1, m314: () => 1 }; }
function c314(): void { say("record/pop/index-of", [([make314().m314].pop())].indexOf(([make314().m314].pop()))); }

interface R315 { a315: number; m315: () => number }
function make315(): R315 { return { a315: 1, m315: () => 1 }; }
const ws315 = new WeakSet<object>();
function c315(): void { say("record/pop/weak-set", (ws315.add(([make315().m315].pop()) as object), ws315.has(([make315().m315].pop()) as object))); }

interface R316 { a316: number; m316: () => number }
function make316(): R316 { return { a316: 1, m316: () => 1 }; }
const wm316 = new WeakMap<object, number>();
function c316(): void { say("record/pop/weak-map", (wm316.set(([make316().m316].pop()) as object, 1), wm316.has(([make316().m316].pop()) as object))); }

interface R317 { a317: number; m317: () => number }
function make317(): R317 { return { a317: 1, m317: () => 1 }; }
function c317(): void { say("record/pop/written", (((([make317().m317].pop())) as any).tag = 1, ((([make317().m317].pop())) as any).tag)); }

interface R318 { a318: number; m318: () => number }
function make318(): R318 { return { a318: 1, m318: () => 1 }; }
function c318(): void { say("record/pop/defined", (Object.defineProperty(([make318().m318].pop()) as object, "t", { value: 1 }), "t" in (([make318().m318].pop()) as object))); }

interface R319 { a319: number; m319: () => number }
function make319(): R319 { return { a319: 1, m319: () => 1 }; }
function c319(): void { say("record/pop/frozen", (Object.freeze(([make319().m319].pop())), Object.isFrozen(([make319().m319].pop())))); }

interface R320 { a320: number; m320: () => number }
function make320(): R320 { return { a320: 1, m320: () => 1 }; }
function c320(): void { say("record/pop/prototype-set", (Object.setPrototypeOf(([make320().m320].pop()) as object, null), Object.getPrototypeOf(([make320().m320].pop())) === null)); }

interface R321 { a321: number; m321: () => number }
function make321(): R321 { return { a321: 1, m321: () => 1 }; }
function c321(): void { say("record/pop/deleted", (delete ((([make321().m321].pop())) as any).length, Object.hasOwn(([make321().m321].pop()) as object, "length"))); }

interface R322 { a322: number; m322: () => number }
function make322(): R322 { return { a322: 1, m322: () => 1 }; }
function same322(a: unknown, b: unknown): boolean { return a === b; }
function c322(): void { say("record/pop/in-a-callee", same322(([make322().m322].pop()), ([make322().m322].pop()))); }

interface R323 { a323: number; m323: () => number }
function make323(): R323 { return { a323: 1, m323: () => 1 }; }
function hit323(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c323(): void { say("record/pop/switch", hit323(([make323().m323].pop()), ([make323().m323].pop()))); }

interface R324 { a324: number; m324: () => number }
function make324(): R324 { return { a324: 1, m324: () => 1 }; }
let last324: unknown;
function seen324(f: unknown): boolean { const same = f === last324; last324 = f; return same; }
function c324(): void { say("record/pop/kept-then-compared", (seen324(([make324().m324].pop())), seen324(([make324().m324].pop())))); }

interface R325 { a325: number; m325: () => number }
function make325(): R325 { return { a325: 1, m325: () => 1 }; }
function c325(): void { say("record/shift/strict-eq", ([make325().m325].shift()) === ([make325().m325].shift())); }

interface R326 { a326: number; m326: () => number }
function make326(): R326 { return { a326: 1, m326: () => 1 }; }
function c326(): void { say("record/shift/strict-ne", ([make326().m326].shift()) !== ([make326().m326].shift())); }

interface R327 { a327: number; m327: () => number }
function make327(): R327 { return { a327: 1, m327: () => 1 }; }
function c327(): void { say("record/shift/loose-eq", ([make327().m327].shift()) == ([make327().m327].shift())); }

interface R328 { a328: number; m328: () => number }
function make328(): R328 { return { a328: 1, m328: () => 1 }; }
function c328(): void { say("record/shift/object-is", Object.is(([make328().m328].shift()), ([make328().m328].shift()))); }

interface R329 { a329: number; m329: () => number }
function make329(): R329 { return { a329: 1, m329: () => 1 }; }
function c329(): void { say("record/shift/set", new Set([([make329().m329].shift()), ([make329().m329].shift())]).size); }

interface R330 { a330: number; m330: () => number }
function make330(): R330 { return { a330: 1, m330: () => 1 }; }
function c330(): void { say("record/shift/map-key", new Map([[([make330().m330].shift()), 1], [([make330().m330].shift()), 2]]).size); }

interface R331 { a331: number; m331: () => number }
function make331(): R331 { return { a331: 1, m331: () => 1 }; }
function c331(): void { say("record/shift/includes", [([make331().m331].shift())].includes(([make331().m331].shift()))); }

interface R332 { a332: number; m332: () => number }
function make332(): R332 { return { a332: 1, m332: () => 1 }; }
function c332(): void { say("record/shift/index-of", [([make332().m332].shift())].indexOf(([make332().m332].shift()))); }

interface R333 { a333: number; m333: () => number }
function make333(): R333 { return { a333: 1, m333: () => 1 }; }
const ws333 = new WeakSet<object>();
function c333(): void { say("record/shift/weak-set", (ws333.add(([make333().m333].shift()) as object), ws333.has(([make333().m333].shift()) as object))); }

interface R334 { a334: number; m334: () => number }
function make334(): R334 { return { a334: 1, m334: () => 1 }; }
const wm334 = new WeakMap<object, number>();
function c334(): void { say("record/shift/weak-map", (wm334.set(([make334().m334].shift()) as object, 1), wm334.has(([make334().m334].shift()) as object))); }

interface R335 { a335: number; m335: () => number }
function make335(): R335 { return { a335: 1, m335: () => 1 }; }
function c335(): void { say("record/shift/written", (((([make335().m335].shift())) as any).tag = 1, ((([make335().m335].shift())) as any).tag)); }

interface R336 { a336: number; m336: () => number }
function make336(): R336 { return { a336: 1, m336: () => 1 }; }
function c336(): void { say("record/shift/defined", (Object.defineProperty(([make336().m336].shift()) as object, "t", { value: 1 }), "t" in (([make336().m336].shift()) as object))); }

interface R337 { a337: number; m337: () => number }
function make337(): R337 { return { a337: 1, m337: () => 1 }; }
function c337(): void { say("record/shift/frozen", (Object.freeze(([make337().m337].shift())), Object.isFrozen(([make337().m337].shift())))); }

interface R338 { a338: number; m338: () => number }
function make338(): R338 { return { a338: 1, m338: () => 1 }; }
function c338(): void { say("record/shift/prototype-set", (Object.setPrototypeOf(([make338().m338].shift()) as object, null), Object.getPrototypeOf(([make338().m338].shift())) === null)); }

interface R339 { a339: number; m339: () => number }
function make339(): R339 { return { a339: 1, m339: () => 1 }; }
function c339(): void { say("record/shift/deleted", (delete ((([make339().m339].shift())) as any).length, Object.hasOwn(([make339().m339].shift()) as object, "length"))); }

interface R340 { a340: number; m340: () => number }
function make340(): R340 { return { a340: 1, m340: () => 1 }; }
function same340(a: unknown, b: unknown): boolean { return a === b; }
function c340(): void { say("record/shift/in-a-callee", same340(([make340().m340].shift()), ([make340().m340].shift()))); }

interface R341 { a341: number; m341: () => number }
function make341(): R341 { return { a341: 1, m341: () => 1 }; }
function hit341(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c341(): void { say("record/shift/switch", hit341(([make341().m341].shift()), ([make341().m341].shift()))); }

interface R342 { a342: number; m342: () => number }
function make342(): R342 { return { a342: 1, m342: () => 1 }; }
let last342: unknown;
function seen342(f: unknown): boolean { const same = f === last342; last342 = f; return same; }
function c342(): void { say("record/shift/kept-then-compared", (seen342(([make342().m342].shift())), seen342(([make342().m342].shift())))); }

interface R343 { a343: number; m343: () => number }
function make343(): R343 { return { a343: 1, m343: () => 1 }; }
function c343(): void { say("record/slice/strict-eq", ([make343().m343].slice()[0]) === ([make343().m343].slice()[0])); }

interface R344 { a344: number; m344: () => number }
function make344(): R344 { return { a344: 1, m344: () => 1 }; }
function c344(): void { say("record/slice/strict-ne", ([make344().m344].slice()[0]) !== ([make344().m344].slice()[0])); }

interface R345 { a345: number; m345: () => number }
function make345(): R345 { return { a345: 1, m345: () => 1 }; }
function c345(): void { say("record/slice/loose-eq", ([make345().m345].slice()[0]) == ([make345().m345].slice()[0])); }

interface R346 { a346: number; m346: () => number }
function make346(): R346 { return { a346: 1, m346: () => 1 }; }
function c346(): void { say("record/slice/object-is", Object.is(([make346().m346].slice()[0]), ([make346().m346].slice()[0]))); }

interface R347 { a347: number; m347: () => number }
function make347(): R347 { return { a347: 1, m347: () => 1 }; }
function c347(): void { say("record/slice/set", new Set([([make347().m347].slice()[0]), ([make347().m347].slice()[0])]).size); }

interface R348 { a348: number; m348: () => number }
function make348(): R348 { return { a348: 1, m348: () => 1 }; }
function c348(): void { say("record/slice/map-key", new Map([[([make348().m348].slice()[0]), 1], [([make348().m348].slice()[0]), 2]]).size); }

interface R349 { a349: number; m349: () => number }
function make349(): R349 { return { a349: 1, m349: () => 1 }; }
function c349(): void { say("record/slice/includes", [([make349().m349].slice()[0])].includes(([make349().m349].slice()[0]))); }

interface R350 { a350: number; m350: () => number }
function make350(): R350 { return { a350: 1, m350: () => 1 }; }
function c350(): void { say("record/slice/index-of", [([make350().m350].slice()[0])].indexOf(([make350().m350].slice()[0]))); }

interface R351 { a351: number; m351: () => number }
function make351(): R351 { return { a351: 1, m351: () => 1 }; }
const ws351 = new WeakSet<object>();
function c351(): void { say("record/slice/weak-set", (ws351.add(([make351().m351].slice()[0]) as object), ws351.has(([make351().m351].slice()[0]) as object))); }

interface R352 { a352: number; m352: () => number }
function make352(): R352 { return { a352: 1, m352: () => 1 }; }
const wm352 = new WeakMap<object, number>();
function c352(): void { say("record/slice/weak-map", (wm352.set(([make352().m352].slice()[0]) as object, 1), wm352.has(([make352().m352].slice()[0]) as object))); }

interface R353 { a353: number; m353: () => number }
function make353(): R353 { return { a353: 1, m353: () => 1 }; }
function c353(): void { say("record/slice/written", (((([make353().m353].slice()[0])) as any).tag = 1, ((([make353().m353].slice()[0])) as any).tag)); }

interface R354 { a354: number; m354: () => number }
function make354(): R354 { return { a354: 1, m354: () => 1 }; }
function c354(): void { say("record/slice/defined", (Object.defineProperty(([make354().m354].slice()[0]) as object, "t", { value: 1 }), "t" in (([make354().m354].slice()[0]) as object))); }

interface R355 { a355: number; m355: () => number }
function make355(): R355 { return { a355: 1, m355: () => 1 }; }
function c355(): void { say("record/slice/frozen", (Object.freeze(([make355().m355].slice()[0])), Object.isFrozen(([make355().m355].slice()[0])))); }

interface R356 { a356: number; m356: () => number }
function make356(): R356 { return { a356: 1, m356: () => 1 }; }
function c356(): void { say("record/slice/prototype-set", (Object.setPrototypeOf(([make356().m356].slice()[0]) as object, null), Object.getPrototypeOf(([make356().m356].slice()[0])) === null)); }

interface R357 { a357: number; m357: () => number }
function make357(): R357 { return { a357: 1, m357: () => 1 }; }
function c357(): void { say("record/slice/deleted", (delete ((([make357().m357].slice()[0])) as any).length, Object.hasOwn(([make357().m357].slice()[0]) as object, "length"))); }

interface R358 { a358: number; m358: () => number }
function make358(): R358 { return { a358: 1, m358: () => 1 }; }
function same358(a: unknown, b: unknown): boolean { return a === b; }
function c358(): void { say("record/slice/in-a-callee", same358(([make358().m358].slice()[0]), ([make358().m358].slice()[0]))); }

interface R359 { a359: number; m359: () => number }
function make359(): R359 { return { a359: 1, m359: () => 1 }; }
function hit359(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c359(): void { say("record/slice/switch", hit359(([make359().m359].slice()[0]), ([make359().m359].slice()[0]))); }

interface R360 { a360: number; m360: () => number }
function make360(): R360 { return { a360: 1, m360: () => 1 }; }
let last360: unknown;
function seen360(f: unknown): boolean { const same = f === last360; last360 = f; return same; }
function c360(): void { say("record/slice/kept-then-compared", (seen360(([make360().m360].slice()[0])), seen360(([make360().m360].slice()[0])))); }

c301(); c302(); c303(); c304(); c305(); c306(); c307(); c308(); c309(); c310(); c311(); c312(); c313(); c314(); c315(); c316(); c317(); c318(); c319(); c320(); c321(); c322(); c323(); c324(); c325(); c326(); c327(); c328(); c329(); c330(); c331(); c332(); c333(); c334(); c335(); c336(); c337(); c338(); c339(); c340(); c341(); c342(); c343(); c344(); c345(); c346(); c347(); c348(); c349(); c350(); c351(); c352(); c353(); c354(); c355(); c356(); c357(); c358(); c359(); c360();
console.log(out.join("\n"));

// GENERATED: say make301 hit305 c347
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="out"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="="
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v1 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = Call v4, v3, v10 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_4]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make301"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: v2 = NewClosure function=[[f_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_5]] fields=[0, 1]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hit305"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=boolean site=[[w_9]]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_9]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = Boolean
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_9]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c347"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v1 = String string="record/slice/set"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v3 = Call v2 calleeName="make347"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_12]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = PropGet v4 key="m347"
// CHECK-NEXT: v6 = NewArray v5 contents=undefined|null|[[f_14]]
// CHECK-NEXT: v7 = PropGet v6 key="slice"
// CHECK-NEXT: v8 = Call v7, v6 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|[[f_14]]> site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = ElemGet v9, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_14]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v14 = Call v13 calleeName="make347"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_12]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = PropGet v15 key="m347"
// CHECK-NEXT: v17 = NewArray v16 contents=undefined|null|[[f_14]]
// CHECK-NEXT: v18 = PropGet v17 key="slice"
// CHECK-NEXT: v19 = Call v18, v17 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array<undefined|null|[[f_14]]> site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = ElemGet v20, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_14]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: v25 = Builtin builtin=Set
// CHECK-NEXT: v26 = Construct v25 calleeName="Set"
// CHECK-NEXT: v27 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v28 = Call v27, v26, v12
// CHECK-NEXT: v29 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v30 = Call v29, v26, v23
// CHECK-NEXT: v31 = Convert v26 declared={type=undefined|null|Set<undefined|null|[[f_14]]> site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v32 = PropGet v31 key="size"
// CHECK-NEXT: v33 = Call v0, -, v1, v32 calleeName="say"
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
