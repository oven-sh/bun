// RUN: lower
// OPTIONS: builtin-modules

// Generated program: object and closure identity stays observable when allocations are removed (second series, part 9).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R541 { a541: number; m541: () => number }
function make541(): R541 { return { a541: 1, m541: () => 1 }; }
function first541(x: unknown): unknown { return x; }
function c541(): void { say("record/reflect-apply/strict-eq", (Reflect.apply(first541, null, [make541().m541])) === (Reflect.apply(first541, null, [make541().m541]))); }

interface R542 { a542: number; m542: () => number }
function make542(): R542 { return { a542: 1, m542: () => 1 }; }
function first542(x: unknown): unknown { return x; }
function c542(): void { say("record/reflect-apply/strict-ne", (Reflect.apply(first542, null, [make542().m542])) !== (Reflect.apply(first542, null, [make542().m542]))); }

interface R543 { a543: number; m543: () => number }
function make543(): R543 { return { a543: 1, m543: () => 1 }; }
function first543(x: unknown): unknown { return x; }
function c543(): void { say("record/reflect-apply/loose-eq", (Reflect.apply(first543, null, [make543().m543])) == (Reflect.apply(first543, null, [make543().m543]))); }

interface R544 { a544: number; m544: () => number }
function make544(): R544 { return { a544: 1, m544: () => 1 }; }
function first544(x: unknown): unknown { return x; }
function c544(): void { say("record/reflect-apply/object-is", Object.is((Reflect.apply(first544, null, [make544().m544])), (Reflect.apply(first544, null, [make544().m544])))); }

interface R545 { a545: number; m545: () => number }
function make545(): R545 { return { a545: 1, m545: () => 1 }; }
function first545(x: unknown): unknown { return x; }
function c545(): void { say("record/reflect-apply/set", new Set([(Reflect.apply(first545, null, [make545().m545])), (Reflect.apply(first545, null, [make545().m545]))]).size); }

interface R546 { a546: number; m546: () => number }
function make546(): R546 { return { a546: 1, m546: () => 1 }; }
function first546(x: unknown): unknown { return x; }
function c546(): void { say("record/reflect-apply/map-key", new Map([[(Reflect.apply(first546, null, [make546().m546])), 1], [(Reflect.apply(first546, null, [make546().m546])), 2]]).size); }

interface R547 { a547: number; m547: () => number }
function make547(): R547 { return { a547: 1, m547: () => 1 }; }
function first547(x: unknown): unknown { return x; }
function c547(): void { say("record/reflect-apply/includes", [(Reflect.apply(first547, null, [make547().m547]))].includes((Reflect.apply(first547, null, [make547().m547])))); }

interface R548 { a548: number; m548: () => number }
function make548(): R548 { return { a548: 1, m548: () => 1 }; }
function first548(x: unknown): unknown { return x; }
function c548(): void { say("record/reflect-apply/index-of", [(Reflect.apply(first548, null, [make548().m548]))].indexOf((Reflect.apply(first548, null, [make548().m548])))); }

interface R549 { a549: number; m549: () => number }
function make549(): R549 { return { a549: 1, m549: () => 1 }; }
function first549(x: unknown): unknown { return x; }
const ws549 = new WeakSet<object>();
function c549(): void { say("record/reflect-apply/weak-set", (ws549.add((Reflect.apply(first549, null, [make549().m549])) as object), ws549.has((Reflect.apply(first549, null, [make549().m549])) as object))); }

interface R550 { a550: number; m550: () => number }
function make550(): R550 { return { a550: 1, m550: () => 1 }; }
function first550(x: unknown): unknown { return x; }
const wm550 = new WeakMap<object, number>();
function c550(): void { say("record/reflect-apply/weak-map", (wm550.set((Reflect.apply(first550, null, [make550().m550])) as object, 1), wm550.has((Reflect.apply(first550, null, [make550().m550])) as object))); }

interface R551 { a551: number; m551: () => number }
function make551(): R551 { return { a551: 1, m551: () => 1 }; }
function first551(x: unknown): unknown { return x; }
function c551(): void { say("record/reflect-apply/written", ((((Reflect.apply(first551, null, [make551().m551]))) as any).tag = 1, (((Reflect.apply(first551, null, [make551().m551]))) as any).tag)); }

interface R552 { a552: number; m552: () => number }
function make552(): R552 { return { a552: 1, m552: () => 1 }; }
function first552(x: unknown): unknown { return x; }
function c552(): void { say("record/reflect-apply/defined", (Object.defineProperty((Reflect.apply(first552, null, [make552().m552])) as object, "t", { value: 1 }), "t" in ((Reflect.apply(first552, null, [make552().m552])) as object))); }

interface R553 { a553: number; m553: () => number }
function make553(): R553 { return { a553: 1, m553: () => 1 }; }
function first553(x: unknown): unknown { return x; }
function c553(): void { say("record/reflect-apply/frozen", (Object.freeze((Reflect.apply(first553, null, [make553().m553]))), Object.isFrozen((Reflect.apply(first553, null, [make553().m553]))))); }

interface R554 { a554: number; m554: () => number }
function make554(): R554 { return { a554: 1, m554: () => 1 }; }
function first554(x: unknown): unknown { return x; }
function c554(): void { say("record/reflect-apply/prototype-set", (Object.setPrototypeOf((Reflect.apply(first554, null, [make554().m554])) as object, null), Object.getPrototypeOf((Reflect.apply(first554, null, [make554().m554]))) === null)); }

interface R555 { a555: number; m555: () => number }
function make555(): R555 { return { a555: 1, m555: () => 1 }; }
function first555(x: unknown): unknown { return x; }
function c555(): void { say("record/reflect-apply/deleted", (delete (((Reflect.apply(first555, null, [make555().m555]))) as any).length, Object.hasOwn((Reflect.apply(first555, null, [make555().m555])) as object, "length"))); }

interface R556 { a556: number; m556: () => number }
function make556(): R556 { return { a556: 1, m556: () => 1 }; }
function first556(x: unknown): unknown { return x; }
function same556(a: unknown, b: unknown): boolean { return a === b; }
function c556(): void { say("record/reflect-apply/in-a-callee", same556((Reflect.apply(first556, null, [make556().m556])), (Reflect.apply(first556, null, [make556().m556])))); }

interface R557 { a557: number; m557: () => number }
function make557(): R557 { return { a557: 1, m557: () => 1 }; }
function first557(x: unknown): unknown { return x; }
function hit557(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c557(): void { say("record/reflect-apply/switch", hit557((Reflect.apply(first557, null, [make557().m557])), (Reflect.apply(first557, null, [make557().m557])))); }

interface R558 { a558: number; m558: () => number }
function make558(): R558 { return { a558: 1, m558: () => 1 }; }
function first558(x: unknown): unknown { return x; }
let last558: unknown;
function seen558(f: unknown): boolean { const same = f === last558; last558 = f; return same; }
function c558(): void { say("record/reflect-apply/kept-then-compared", (seen558((Reflect.apply(first558, null, [make558().m558]))), seen558((Reflect.apply(first558, null, [make558().m558]))))); }

interface R559 { a559: number; m559: () => number }
function make559(): R559 { return { a559: 1, m559: () => 1 }; }
function c559(): void { say("record/logical-or/strict-eq", (((0 as unknown) || make559().m559)) === (((0 as unknown) || make559().m559))); }

interface R560 { a560: number; m560: () => number }
function make560(): R560 { return { a560: 1, m560: () => 1 }; }
function c560(): void { say("record/logical-or/strict-ne", (((0 as unknown) || make560().m560)) !== (((0 as unknown) || make560().m560))); }

interface R561 { a561: number; m561: () => number }
function make561(): R561 { return { a561: 1, m561: () => 1 }; }
function c561(): void { say("record/logical-or/loose-eq", (((0 as unknown) || make561().m561)) == (((0 as unknown) || make561().m561))); }

interface R562 { a562: number; m562: () => number }
function make562(): R562 { return { a562: 1, m562: () => 1 }; }
function c562(): void { say("record/logical-or/object-is", Object.is((((0 as unknown) || make562().m562)), (((0 as unknown) || make562().m562)))); }

interface R563 { a563: number; m563: () => number }
function make563(): R563 { return { a563: 1, m563: () => 1 }; }
function c563(): void { say("record/logical-or/set", new Set([(((0 as unknown) || make563().m563)), (((0 as unknown) || make563().m563))]).size); }

interface R564 { a564: number; m564: () => number }
function make564(): R564 { return { a564: 1, m564: () => 1 }; }
function c564(): void { say("record/logical-or/map-key", new Map([[(((0 as unknown) || make564().m564)), 1], [(((0 as unknown) || make564().m564)), 2]]).size); }

interface R565 { a565: number; m565: () => number }
function make565(): R565 { return { a565: 1, m565: () => 1 }; }
function c565(): void { say("record/logical-or/includes", [(((0 as unknown) || make565().m565))].includes((((0 as unknown) || make565().m565)))); }

interface R566 { a566: number; m566: () => number }
function make566(): R566 { return { a566: 1, m566: () => 1 }; }
function c566(): void { say("record/logical-or/index-of", [(((0 as unknown) || make566().m566))].indexOf((((0 as unknown) || make566().m566)))); }

interface R567 { a567: number; m567: () => number }
function make567(): R567 { return { a567: 1, m567: () => 1 }; }
const ws567 = new WeakSet<object>();
function c567(): void { say("record/logical-or/weak-set", (ws567.add((((0 as unknown) || make567().m567)) as object), ws567.has((((0 as unknown) || make567().m567)) as object))); }

interface R568 { a568: number; m568: () => number }
function make568(): R568 { return { a568: 1, m568: () => 1 }; }
const wm568 = new WeakMap<object, number>();
function c568(): void { say("record/logical-or/weak-map", (wm568.set((((0 as unknown) || make568().m568)) as object, 1), wm568.has((((0 as unknown) || make568().m568)) as object))); }

interface R569 { a569: number; m569: () => number }
function make569(): R569 { return { a569: 1, m569: () => 1 }; }
function c569(): void { say("record/logical-or/written", ((((((0 as unknown) || make569().m569))) as any).tag = 1, (((((0 as unknown) || make569().m569))) as any).tag)); }

interface R570 { a570: number; m570: () => number }
function make570(): R570 { return { a570: 1, m570: () => 1 }; }
function c570(): void { say("record/logical-or/defined", (Object.defineProperty((((0 as unknown) || make570().m570)) as object, "t", { value: 1 }), "t" in ((((0 as unknown) || make570().m570)) as object))); }

interface R571 { a571: number; m571: () => number }
function make571(): R571 { return { a571: 1, m571: () => 1 }; }
function c571(): void { say("record/logical-or/frozen", (Object.freeze((((0 as unknown) || make571().m571))), Object.isFrozen((((0 as unknown) || make571().m571))))); }

interface R572 { a572: number; m572: () => number }
function make572(): R572 { return { a572: 1, m572: () => 1 }; }
function c572(): void { say("record/logical-or/prototype-set", (Object.setPrototypeOf((((0 as unknown) || make572().m572)) as object, null), Object.getPrototypeOf((((0 as unknown) || make572().m572))) === null)); }

interface R573 { a573: number; m573: () => number }
function make573(): R573 { return { a573: 1, m573: () => 1 }; }
function c573(): void { say("record/logical-or/deleted", (delete (((((0 as unknown) || make573().m573))) as any).length, Object.hasOwn((((0 as unknown) || make573().m573)) as object, "length"))); }

interface R574 { a574: number; m574: () => number }
function make574(): R574 { return { a574: 1, m574: () => 1 }; }
function same574(a: unknown, b: unknown): boolean { return a === b; }
function c574(): void { say("record/logical-or/in-a-callee", same574((((0 as unknown) || make574().m574)), (((0 as unknown) || make574().m574)))); }

interface R575 { a575: number; m575: () => number }
function make575(): R575 { return { a575: 1, m575: () => 1 }; }
function hit575(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c575(): void { say("record/logical-or/switch", hit575((((0 as unknown) || make575().m575)), (((0 as unknown) || make575().m575)))); }

interface R576 { a576: number; m576: () => number }
function make576(): R576 { return { a576: 1, m576: () => 1 }; }
let last576: unknown;
function seen576(f: unknown): boolean { const same = f === last576; last576 = f; return same; }
function c576(): void { say("record/logical-or/kept-then-compared", (seen576((((0 as unknown) || make576().m576))), seen576((((0 as unknown) || make576().m576))))); }

interface R577 { a577: number; m577: () => number }
function make577(): R577 { return { a577: 1, m577: () => 1 }; }
let none577: unknown;
function c577(): void { say("record/nullish/strict-eq", ((none577 ?? make577().m577)) === ((none577 ?? make577().m577))); }

interface R578 { a578: number; m578: () => number }
function make578(): R578 { return { a578: 1, m578: () => 1 }; }
let none578: unknown;
function c578(): void { say("record/nullish/strict-ne", ((none578 ?? make578().m578)) !== ((none578 ?? make578().m578))); }

interface R579 { a579: number; m579: () => number }
function make579(): R579 { return { a579: 1, m579: () => 1 }; }
let none579: unknown;
function c579(): void { say("record/nullish/loose-eq", ((none579 ?? make579().m579)) == ((none579 ?? make579().m579))); }

interface R580 { a580: number; m580: () => number }
function make580(): R580 { return { a580: 1, m580: () => 1 }; }
let none580: unknown;
function c580(): void { say("record/nullish/object-is", Object.is(((none580 ?? make580().m580)), ((none580 ?? make580().m580)))); }

interface R581 { a581: number; m581: () => number }
function make581(): R581 { return { a581: 1, m581: () => 1 }; }
let none581: unknown;
function c581(): void { say("record/nullish/set", new Set([((none581 ?? make581().m581)), ((none581 ?? make581().m581))]).size); }

interface R582 { a582: number; m582: () => number }
function make582(): R582 { return { a582: 1, m582: () => 1 }; }
let none582: unknown;
function c582(): void { say("record/nullish/map-key", new Map([[((none582 ?? make582().m582)), 1], [((none582 ?? make582().m582)), 2]]).size); }

interface R583 { a583: number; m583: () => number }
function make583(): R583 { return { a583: 1, m583: () => 1 }; }
let none583: unknown;
function c583(): void { say("record/nullish/includes", [((none583 ?? make583().m583))].includes(((none583 ?? make583().m583)))); }

interface R584 { a584: number; m584: () => number }
function make584(): R584 { return { a584: 1, m584: () => 1 }; }
let none584: unknown;
function c584(): void { say("record/nullish/index-of", [((none584 ?? make584().m584))].indexOf(((none584 ?? make584().m584)))); }

interface R585 { a585: number; m585: () => number }
function make585(): R585 { return { a585: 1, m585: () => 1 }; }
let none585: unknown;
const ws585 = new WeakSet<object>();
function c585(): void { say("record/nullish/weak-set", (ws585.add(((none585 ?? make585().m585)) as object), ws585.has(((none585 ?? make585().m585)) as object))); }

interface R586 { a586: number; m586: () => number }
function make586(): R586 { return { a586: 1, m586: () => 1 }; }
let none586: unknown;
const wm586 = new WeakMap<object, number>();
function c586(): void { say("record/nullish/weak-map", (wm586.set(((none586 ?? make586().m586)) as object, 1), wm586.has(((none586 ?? make586().m586)) as object))); }

interface R587 { a587: number; m587: () => number }
function make587(): R587 { return { a587: 1, m587: () => 1 }; }
let none587: unknown;
function c587(): void { say("record/nullish/written", (((((none587 ?? make587().m587))) as any).tag = 1, ((((none587 ?? make587().m587))) as any).tag)); }

interface R588 { a588: number; m588: () => number }
function make588(): R588 { return { a588: 1, m588: () => 1 }; }
let none588: unknown;
function c588(): void { say("record/nullish/defined", (Object.defineProperty(((none588 ?? make588().m588)) as object, "t", { value: 1 }), "t" in (((none588 ?? make588().m588)) as object))); }

interface R589 { a589: number; m589: () => number }
function make589(): R589 { return { a589: 1, m589: () => 1 }; }
let none589: unknown;
function c589(): void { say("record/nullish/frozen", (Object.freeze(((none589 ?? make589().m589))), Object.isFrozen(((none589 ?? make589().m589))))); }

interface R590 { a590: number; m590: () => number }
function make590(): R590 { return { a590: 1, m590: () => 1 }; }
let none590: unknown;
function c590(): void { say("record/nullish/prototype-set", (Object.setPrototypeOf(((none590 ?? make590().m590)) as object, null), Object.getPrototypeOf(((none590 ?? make590().m590))) === null)); }

interface R591 { a591: number; m591: () => number }
function make591(): R591 { return { a591: 1, m591: () => 1 }; }
let none591: unknown;
function c591(): void { say("record/nullish/deleted", (delete ((((none591 ?? make591().m591))) as any).length, Object.hasOwn(((none591 ?? make591().m591)) as object, "length"))); }

interface R592 { a592: number; m592: () => number }
function make592(): R592 { return { a592: 1, m592: () => 1 }; }
let none592: unknown;
function same592(a: unknown, b: unknown): boolean { return a === b; }
function c592(): void { say("record/nullish/in-a-callee", same592(((none592 ?? make592().m592)), ((none592 ?? make592().m592)))); }

interface R593 { a593: number; m593: () => number }
function make593(): R593 { return { a593: 1, m593: () => 1 }; }
let none593: unknown;
function hit593(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c593(): void { say("record/nullish/switch", hit593(((none593 ?? make593().m593)), ((none593 ?? make593().m593)))); }

interface R594 { a594: number; m594: () => number }
function make594(): R594 { return { a594: 1, m594: () => 1 }; }
let none594: unknown;
let last594: unknown;
function seen594(f: unknown): boolean { const same = f === last594; last594 = f; return same; }
function c594(): void { say("record/nullish/kept-then-compared", (seen594(((none594 ?? make594().m594))), seen594(((none594 ?? make594().m594))))); }

interface R595 { a595: number; m595: () => number }
function make595(): R595 { return { a595: 1, m595: () => 1 }; }
function c595(): void { say("record/comma/strict-eq", ((out.length, make595().m595)) === ((out.length, make595().m595))); }

interface R596 { a596: number; m596: () => number }
function make596(): R596 { return { a596: 1, m596: () => 1 }; }
function c596(): void { say("record/comma/strict-ne", ((out.length, make596().m596)) !== ((out.length, make596().m596))); }

interface R597 { a597: number; m597: () => number }
function make597(): R597 { return { a597: 1, m597: () => 1 }; }
function c597(): void { say("record/comma/loose-eq", ((out.length, make597().m597)) == ((out.length, make597().m597))); }

interface R598 { a598: number; m598: () => number }
function make598(): R598 { return { a598: 1, m598: () => 1 }; }
function c598(): void { say("record/comma/object-is", Object.is(((out.length, make598().m598)), ((out.length, make598().m598)))); }

interface R599 { a599: number; m599: () => number }
function make599(): R599 { return { a599: 1, m599: () => 1 }; }
function c599(): void { say("record/comma/set", new Set([((out.length, make599().m599)), ((out.length, make599().m599))]).size); }

interface R600 { a600: number; m600: () => number }
function make600(): R600 { return { a600: 1, m600: () => 1 }; }
function c600(): void { say("record/comma/map-key", new Map([[((out.length, make600().m600)), 1], [((out.length, make600().m600)), 2]]).size); }

c541(); c542(); c543(); c544(); c545(); c546(); c547(); c548(); c549(); c550(); c551(); c552(); c553(); c554(); c555(); c556(); c557(); c558(); c559(); c560(); c561(); c562(); c563(); c564(); c565(); c566(); c567(); c568(); c569(); c570(); c571(); c572(); c573(); c574(); c575(); c576(); c577(); c578(); c579(); c580(); c581(); c582(); c583(); c584(); c585(); c586(); c587(); c588(); c589(); c590(); c591(); c592(); c593(); c594(); c595(); c596(); c597(); c598(); c599(); c600();
console.log(out.join("\n"));

// GENERATED: make541 seen558 c555 c599
// CHECK-LABEL: function {{*}}name="make541"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_1]] fields=[0, 1]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="seen558"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="last558"
// CHECK-NEXT: v3 = StrictEq v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="last558"
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_6]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c555"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = String string="record/reflect-apply/deleted"
// CHECK-NEXT: v2 = Builtin builtin=Reflect
// CHECK-NEXT: v3 = Builtin builtin=ReflectApply
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v5 = Null
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v7 = Call v6 calleeName="make555"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = PropGet v8 key="m555"
// CHECK-NEXT: v10 = NewArray v9 contents=anything
// CHECK-NEXT: v11 = Call v3, v2, v4, v5, v10 calleeName="Reflect.apply"
// CHECK-NEXT: v12 = PropDelete v11 key="length"
// CHECK-NEXT: v13 = Builtin builtin=Object
// CHECK-NEXT: v14 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v15 = Builtin builtin=Reflect
// CHECK-NEXT: v16 = Builtin builtin=ReflectApply
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v18 = Null
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v20 = Call v19 calleeName="make555"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[L_11]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v22 = PropGet v21 key="m555"
// CHECK-NEXT: v23 = NewArray v22 contents=anything
// CHECK-NEXT: v24 = Call v16, v15, v17, v18, v23 calleeName="Reflect.apply"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|object site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v26 = String string="length"
// CHECK-NEXT: v27 = Call v14, v13, v25, v26 calleeName="Object.hasOwn"
// CHECK-NEXT: v28 = Convert v27 declared={type=boolean site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = Call v0, -, v1, v28 calleeName="say"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c599"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = String string="record/comma/set"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="out"
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v6 = Call v5 calleeName="make599"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_18]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="m599"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="out"
// CHECK-NEXT: v11 = PropGet v10 key="length"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v13 = Call v12 calleeName="make599"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_18]] site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v15 = PropGet v14 key="m599"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = Builtin builtin=Set
// CHECK-NEXT: v18 = Construct v17 calleeName="Set"
// CHECK-NEXT: v19 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v20 = Call v19, v18, v8
// CHECK-NEXT: v21 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v22 = Call v21, v18, v15
// CHECK-NEXT: v23 = Convert v18 declared={type=undefined|null|Set<undefined|null|[[f_21]]> site=[[w_22]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v24 = PropGet v23 key="size"
// CHECK-NEXT: v25 = Call v0, -, v1, v24 calleeName="say"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
