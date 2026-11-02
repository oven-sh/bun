// RUN: lower
// OPTIONS: builtin-modules

// Generated program: object and closure identity stays observable when allocations are removed (second series, part 10).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R601 { a601: number; m601: () => number }
function make601(): R601 { return { a601: 1, m601: () => 1 }; }
function c601(): void { say("record/comma/includes", [((out.length, make601().m601))].includes(((out.length, make601().m601)))); }

interface R602 { a602: number; m602: () => number }
function make602(): R602 { return { a602: 1, m602: () => 1 }; }
function c602(): void { say("record/comma/index-of", [((out.length, make602().m602))].indexOf(((out.length, make602().m602)))); }

interface R603 { a603: number; m603: () => number }
function make603(): R603 { return { a603: 1, m603: () => 1 }; }
const ws603 = new WeakSet<object>();
function c603(): void { say("record/comma/weak-set", (ws603.add(((out.length, make603().m603)) as object), ws603.has(((out.length, make603().m603)) as object))); }

interface R604 { a604: number; m604: () => number }
function make604(): R604 { return { a604: 1, m604: () => 1 }; }
const wm604 = new WeakMap<object, number>();
function c604(): void { say("record/comma/weak-map", (wm604.set(((out.length, make604().m604)) as object, 1), wm604.has(((out.length, make604().m604)) as object))); }

interface R605 { a605: number; m605: () => number }
function make605(): R605 { return { a605: 1, m605: () => 1 }; }
function c605(): void { say("record/comma/written", (((((out.length, make605().m605))) as any).tag = 1, ((((out.length, make605().m605))) as any).tag)); }

interface R606 { a606: number; m606: () => number }
function make606(): R606 { return { a606: 1, m606: () => 1 }; }
function c606(): void { say("record/comma/defined", (Object.defineProperty(((out.length, make606().m606)) as object, "t", { value: 1 }), "t" in (((out.length, make606().m606)) as object))); }

interface R607 { a607: number; m607: () => number }
function make607(): R607 { return { a607: 1, m607: () => 1 }; }
function c607(): void { say("record/comma/frozen", (Object.freeze(((out.length, make607().m607))), Object.isFrozen(((out.length, make607().m607))))); }

interface R608 { a608: number; m608: () => number }
function make608(): R608 { return { a608: 1, m608: () => 1 }; }
function c608(): void { say("record/comma/prototype-set", (Object.setPrototypeOf(((out.length, make608().m608)) as object, null), Object.getPrototypeOf(((out.length, make608().m608))) === null)); }

interface R609 { a609: number; m609: () => number }
function make609(): R609 { return { a609: 1, m609: () => 1 }; }
function c609(): void { say("record/comma/deleted", (delete ((((out.length, make609().m609))) as any).length, Object.hasOwn(((out.length, make609().m609)) as object, "length"))); }

interface R610 { a610: number; m610: () => number }
function make610(): R610 { return { a610: 1, m610: () => 1 }; }
function same610(a: unknown, b: unknown): boolean { return a === b; }
function c610(): void { say("record/comma/in-a-callee", same610(((out.length, make610().m610)), ((out.length, make610().m610)))); }

interface R611 { a611: number; m611: () => number }
function make611(): R611 { return { a611: 1, m611: () => 1 }; }
function hit611(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c611(): void { say("record/comma/switch", hit611(((out.length, make611().m611)), ((out.length, make611().m611)))); }

interface R612 { a612: number; m612: () => number }
function make612(): R612 { return { a612: 1, m612: () => 1 }; }
let last612: unknown;
function seen612(f: unknown): boolean { const same = f === last612; last612 = f; return same; }
function c612(): void { say("record/comma/kept-then-compared", (seen612(((out.length, make612().m612))), seen612(((out.length, make612().m612))))); }

interface R613 { a613: number; m613: () => number }
function make613(): R613 { return { a613: 1, m613: () => 1 }; }
function c613(): void { say("record/computed-member/strict-eq", (({ ["k"]: make613().m613 })["k"]) === (({ ["k"]: make613().m613 })["k"])); }

interface R614 { a614: number; m614: () => number }
function make614(): R614 { return { a614: 1, m614: () => 1 }; }
function c614(): void { say("record/computed-member/strict-ne", (({ ["k"]: make614().m614 })["k"]) !== (({ ["k"]: make614().m614 })["k"])); }

interface R615 { a615: number; m615: () => number }
function make615(): R615 { return { a615: 1, m615: () => 1 }; }
function c615(): void { say("record/computed-member/loose-eq", (({ ["k"]: make615().m615 })["k"]) == (({ ["k"]: make615().m615 })["k"])); }

interface R616 { a616: number; m616: () => number }
function make616(): R616 { return { a616: 1, m616: () => 1 }; }
function c616(): void { say("record/computed-member/object-is", Object.is((({ ["k"]: make616().m616 })["k"]), (({ ["k"]: make616().m616 })["k"]))); }

interface R617 { a617: number; m617: () => number }
function make617(): R617 { return { a617: 1, m617: () => 1 }; }
function c617(): void { say("record/computed-member/set", new Set([(({ ["k"]: make617().m617 })["k"]), (({ ["k"]: make617().m617 })["k"])]).size); }

interface R618 { a618: number; m618: () => number }
function make618(): R618 { return { a618: 1, m618: () => 1 }; }
function c618(): void { say("record/computed-member/map-key", new Map([[(({ ["k"]: make618().m618 })["k"]), 1], [(({ ["k"]: make618().m618 })["k"]), 2]]).size); }

interface R619 { a619: number; m619: () => number }
function make619(): R619 { return { a619: 1, m619: () => 1 }; }
function c619(): void { say("record/computed-member/includes", [(({ ["k"]: make619().m619 })["k"])].includes((({ ["k"]: make619().m619 })["k"]))); }

interface R620 { a620: number; m620: () => number }
function make620(): R620 { return { a620: 1, m620: () => 1 }; }
function c620(): void { say("record/computed-member/index-of", [(({ ["k"]: make620().m620 })["k"])].indexOf((({ ["k"]: make620().m620 })["k"]))); }

interface R621 { a621: number; m621: () => number }
function make621(): R621 { return { a621: 1, m621: () => 1 }; }
const ws621 = new WeakSet<object>();
function c621(): void { say("record/computed-member/weak-set", (ws621.add((({ ["k"]: make621().m621 })["k"]) as object), ws621.has((({ ["k"]: make621().m621 })["k"]) as object))); }

interface R622 { a622: number; m622: () => number }
function make622(): R622 { return { a622: 1, m622: () => 1 }; }
const wm622 = new WeakMap<object, number>();
function c622(): void { say("record/computed-member/weak-map", (wm622.set((({ ["k"]: make622().m622 })["k"]) as object, 1), wm622.has((({ ["k"]: make622().m622 })["k"]) as object))); }

interface R623 { a623: number; m623: () => number }
function make623(): R623 { return { a623: 1, m623: () => 1 }; }
function c623(): void { say("record/computed-member/written", ((((({ ["k"]: make623().m623 })["k"])) as any).tag = 1, (((({ ["k"]: make623().m623 })["k"])) as any).tag)); }

interface R624 { a624: number; m624: () => number }
function make624(): R624 { return { a624: 1, m624: () => 1 }; }
function c624(): void { say("record/computed-member/defined", (Object.defineProperty((({ ["k"]: make624().m624 })["k"]) as object, "t", { value: 1 }), "t" in ((({ ["k"]: make624().m624 })["k"]) as object))); }

interface R625 { a625: number; m625: () => number }
function make625(): R625 { return { a625: 1, m625: () => 1 }; }
function c625(): void { say("record/computed-member/frozen", (Object.freeze((({ ["k"]: make625().m625 })["k"])), Object.isFrozen((({ ["k"]: make625().m625 })["k"])))); }

interface R626 { a626: number; m626: () => number }
function make626(): R626 { return { a626: 1, m626: () => 1 }; }
function c626(): void { say("record/computed-member/prototype-set", (Object.setPrototypeOf((({ ["k"]: make626().m626 })["k"]) as object, null), Object.getPrototypeOf((({ ["k"]: make626().m626 })["k"])) === null)); }

interface R627 { a627: number; m627: () => number }
function make627(): R627 { return { a627: 1, m627: () => 1 }; }
function c627(): void { say("record/computed-member/deleted", (delete (((({ ["k"]: make627().m627 })["k"])) as any).length, Object.hasOwn((({ ["k"]: make627().m627 })["k"]) as object, "length"))); }

interface R628 { a628: number; m628: () => number }
function make628(): R628 { return { a628: 1, m628: () => 1 }; }
function same628(a: unknown, b: unknown): boolean { return a === b; }
function c628(): void { say("record/computed-member/in-a-callee", same628((({ ["k"]: make628().m628 })["k"]), (({ ["k"]: make628().m628 })["k"]))); }

interface R629 { a629: number; m629: () => number }
function make629(): R629 { return { a629: 1, m629: () => 1 }; }
function hit629(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c629(): void { say("record/computed-member/switch", hit629((({ ["k"]: make629().m629 })["k"]), (({ ["k"]: make629().m629 })["k"]))); }

interface R630 { a630: number; m630: () => number }
function make630(): R630 { return { a630: 1, m630: () => 1 }; }
let last630: unknown;
function seen630(f: unknown): boolean { const same = f === last630; last630 = f; return same; }
function c630(): void { say("record/computed-member/kept-then-compared", (seen630((({ ["k"]: make630().m630 })["k"])), seen630((({ ["k"]: make630().m630 })["k"])))); }

interface R631 { a631: number; m631: () => number }
function make631(): R631 { return { a631: 1, m631: () => 1 }; }
const s631 = Symbol();
function c631(): void { say("record/symbol-member/strict-eq", (({ [s631]: make631().m631 })[s631]) === (({ [s631]: make631().m631 })[s631])); }

interface R632 { a632: number; m632: () => number }
function make632(): R632 { return { a632: 1, m632: () => 1 }; }
const s632 = Symbol();
function c632(): void { say("record/symbol-member/strict-ne", (({ [s632]: make632().m632 })[s632]) !== (({ [s632]: make632().m632 })[s632])); }

interface R633 { a633: number; m633: () => number }
function make633(): R633 { return { a633: 1, m633: () => 1 }; }
const s633 = Symbol();
function c633(): void { say("record/symbol-member/loose-eq", (({ [s633]: make633().m633 })[s633]) == (({ [s633]: make633().m633 })[s633])); }

interface R634 { a634: number; m634: () => number }
function make634(): R634 { return { a634: 1, m634: () => 1 }; }
const s634 = Symbol();
function c634(): void { say("record/symbol-member/object-is", Object.is((({ [s634]: make634().m634 })[s634]), (({ [s634]: make634().m634 })[s634]))); }

interface R635 { a635: number; m635: () => number }
function make635(): R635 { return { a635: 1, m635: () => 1 }; }
const s635 = Symbol();
function c635(): void { say("record/symbol-member/set", new Set([(({ [s635]: make635().m635 })[s635]), (({ [s635]: make635().m635 })[s635])]).size); }

interface R636 { a636: number; m636: () => number }
function make636(): R636 { return { a636: 1, m636: () => 1 }; }
const s636 = Symbol();
function c636(): void { say("record/symbol-member/map-key", new Map([[(({ [s636]: make636().m636 })[s636]), 1], [(({ [s636]: make636().m636 })[s636]), 2]]).size); }

interface R637 { a637: number; m637: () => number }
function make637(): R637 { return { a637: 1, m637: () => 1 }; }
const s637 = Symbol();
function c637(): void { say("record/symbol-member/includes", [(({ [s637]: make637().m637 })[s637])].includes((({ [s637]: make637().m637 })[s637]))); }

interface R638 { a638: number; m638: () => number }
function make638(): R638 { return { a638: 1, m638: () => 1 }; }
const s638 = Symbol();
function c638(): void { say("record/symbol-member/index-of", [(({ [s638]: make638().m638 })[s638])].indexOf((({ [s638]: make638().m638 })[s638]))); }

interface R639 { a639: number; m639: () => number }
function make639(): R639 { return { a639: 1, m639: () => 1 }; }
const s639 = Symbol();
const ws639 = new WeakSet<object>();
function c639(): void { say("record/symbol-member/weak-set", (ws639.add((({ [s639]: make639().m639 })[s639]) as object), ws639.has((({ [s639]: make639().m639 })[s639]) as object))); }

interface R640 { a640: number; m640: () => number }
function make640(): R640 { return { a640: 1, m640: () => 1 }; }
const s640 = Symbol();
const wm640 = new WeakMap<object, number>();
function c640(): void { say("record/symbol-member/weak-map", (wm640.set((({ [s640]: make640().m640 })[s640]) as object, 1), wm640.has((({ [s640]: make640().m640 })[s640]) as object))); }

interface R641 { a641: number; m641: () => number }
function make641(): R641 { return { a641: 1, m641: () => 1 }; }
const s641 = Symbol();
function c641(): void { say("record/symbol-member/written", ((((({ [s641]: make641().m641 })[s641])) as any).tag = 1, (((({ [s641]: make641().m641 })[s641])) as any).tag)); }

interface R642 { a642: number; m642: () => number }
function make642(): R642 { return { a642: 1, m642: () => 1 }; }
const s642 = Symbol();
function c642(): void { say("record/symbol-member/defined", (Object.defineProperty((({ [s642]: make642().m642 })[s642]) as object, "t", { value: 1 }), "t" in ((({ [s642]: make642().m642 })[s642]) as object))); }

interface R643 { a643: number; m643: () => number }
function make643(): R643 { return { a643: 1, m643: () => 1 }; }
const s643 = Symbol();
function c643(): void { say("record/symbol-member/frozen", (Object.freeze((({ [s643]: make643().m643 })[s643])), Object.isFrozen((({ [s643]: make643().m643 })[s643])))); }

interface R644 { a644: number; m644: () => number }
function make644(): R644 { return { a644: 1, m644: () => 1 }; }
const s644 = Symbol();
function c644(): void { say("record/symbol-member/prototype-set", (Object.setPrototypeOf((({ [s644]: make644().m644 })[s644]) as object, null), Object.getPrototypeOf((({ [s644]: make644().m644 })[s644])) === null)); }

interface R645 { a645: number; m645: () => number }
function make645(): R645 { return { a645: 1, m645: () => 1 }; }
const s645 = Symbol();
function c645(): void { say("record/symbol-member/deleted", (delete (((({ [s645]: make645().m645 })[s645])) as any).length, Object.hasOwn((({ [s645]: make645().m645 })[s645]) as object, "length"))); }

interface R646 { a646: number; m646: () => number }
function make646(): R646 { return { a646: 1, m646: () => 1 }; }
const s646 = Symbol();
function same646(a: unknown, b: unknown): boolean { return a === b; }
function c646(): void { say("record/symbol-member/in-a-callee", same646((({ [s646]: make646().m646 })[s646]), (({ [s646]: make646().m646 })[s646]))); }

interface R647 { a647: number; m647: () => number }
function make647(): R647 { return { a647: 1, m647: () => 1 }; }
const s647 = Symbol();
function hit647(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c647(): void { say("record/symbol-member/switch", hit647((({ [s647]: make647().m647 })[s647]), (({ [s647]: make647().m647 })[s647]))); }

interface R648 { a648: number; m648: () => number }
function make648(): R648 { return { a648: 1, m648: () => 1 }; }
const s648 = Symbol();
let last648: unknown;
function seen648(f: unknown): boolean { const same = f === last648; last648 = f; return same; }
function c648(): void { say("record/symbol-member/kept-then-compared", (seen648((({ [s648]: make648().m648 })[s648])), seen648((({ [s648]: make648().m648 })[s648])))); }

interface R649 { a649: number; m649: () => number }
function make649(): R649 { return { a649: 1, m649: () => 1 }; }
function c649(): void { say("record/getter-member/strict-eq", (({ get f(): unknown { return make649().m649; } }).f) === (({ get f(): unknown { return make649().m649; } }).f)); }

interface R650 { a650: number; m650: () => number }
function make650(): R650 { return { a650: 1, m650: () => 1 }; }
function c650(): void { say("record/getter-member/strict-ne", (({ get f(): unknown { return make650().m650; } }).f) !== (({ get f(): unknown { return make650().m650; } }).f)); }

interface R651 { a651: number; m651: () => number }
function make651(): R651 { return { a651: 1, m651: () => 1 }; }
function c651(): void { say("record/getter-member/loose-eq", (({ get f(): unknown { return make651().m651; } }).f) == (({ get f(): unknown { return make651().m651; } }).f)); }

interface R652 { a652: number; m652: () => number }
function make652(): R652 { return { a652: 1, m652: () => 1 }; }
function c652(): void { say("record/getter-member/object-is", Object.is((({ get f(): unknown { return make652().m652; } }).f), (({ get f(): unknown { return make652().m652; } }).f))); }

interface R653 { a653: number; m653: () => number }
function make653(): R653 { return { a653: 1, m653: () => 1 }; }
function c653(): void { say("record/getter-member/set", new Set([(({ get f(): unknown { return make653().m653; } }).f), (({ get f(): unknown { return make653().m653; } }).f)]).size); }

interface R654 { a654: number; m654: () => number }
function make654(): R654 { return { a654: 1, m654: () => 1 }; }
function c654(): void { say("record/getter-member/map-key", new Map([[(({ get f(): unknown { return make654().m654; } }).f), 1], [(({ get f(): unknown { return make654().m654; } }).f), 2]]).size); }

interface R655 { a655: number; m655: () => number }
function make655(): R655 { return { a655: 1, m655: () => 1 }; }
function c655(): void { say("record/getter-member/includes", [(({ get f(): unknown { return make655().m655; } }).f)].includes((({ get f(): unknown { return make655().m655; } }).f))); }

interface R656 { a656: number; m656: () => number }
function make656(): R656 { return { a656: 1, m656: () => 1 }; }
function c656(): void { say("record/getter-member/index-of", [(({ get f(): unknown { return make656().m656; } }).f)].indexOf((({ get f(): unknown { return make656().m656; } }).f))); }

interface R657 { a657: number; m657: () => number }
function make657(): R657 { return { a657: 1, m657: () => 1 }; }
const ws657 = new WeakSet<object>();
function c657(): void { say("record/getter-member/weak-set", (ws657.add((({ get f(): unknown { return make657().m657; } }).f) as object), ws657.has((({ get f(): unknown { return make657().m657; } }).f) as object))); }

interface R658 { a658: number; m658: () => number }
function make658(): R658 { return { a658: 1, m658: () => 1 }; }
const wm658 = new WeakMap<object, number>();
function c658(): void { say("record/getter-member/weak-map", (wm658.set((({ get f(): unknown { return make658().m658; } }).f) as object, 1), wm658.has((({ get f(): unknown { return make658().m658; } }).f) as object))); }

interface R659 { a659: number; m659: () => number }
function make659(): R659 { return { a659: 1, m659: () => 1 }; }
function c659(): void { say("record/getter-member/written", ((((({ get f(): unknown { return make659().m659; } }).f)) as any).tag = 1, (((({ get f(): unknown { return make659().m659; } }).f)) as any).tag)); }

interface R660 { a660: number; m660: () => number }
function make660(): R660 { return { a660: 1, m660: () => 1 }; }
function c660(): void { say("record/getter-member/defined", (Object.defineProperty((({ get f(): unknown { return make660().m660; } }).f) as object, "t", { value: 1 }), "t" in ((({ get f(): unknown { return make660().m660; } }).f) as object))); }

c601(); c602(); c603(); c604(); c605(); c606(); c607(); c608(); c609(); c610(); c611(); c612(); c613(); c614(); c615(); c616(); c617(); c618(); c619(); c620(); c621(); c622(); c623(); c624(); c625(); c626(); c627(); c628(); c629(); c630(); c631(); c632(); c633(); c634(); c635(); c636(); c637(); c638(); c639(); c640(); c641(); c642(); c643(); c644(); c645(); c646(); c647(); c648(); c649(); c650(); c651(); c652(); c653(); c654(); c655(); c656(); c657(); c658(); c659(); c660();
console.log(out.join("\n"));

// GENERATED: hit611 c644 c653
// CHECK-LABEL: function {{*}}name="hit611"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=boolean site=[[w_1]]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_1]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = Boolean
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_1]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c644"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = String string="record/symbol-member/prototype-set"
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectSetPrototypeOf
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="s644"
// CHECK-NEXT: v6 = ToPropertyKey v5
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = Call v7 calleeName="make644"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = PropGet v9 key="m644"
// CHECK-NEXT: v11 = NewObject layout=[[L_7]]
// CHECK-NEXT: ElemDefine v11, v6, v10
// CHECK-NEXT: v13 = FinishObject v11
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="s644"
// CHECK-NEXT: v16 = ElemGet v13, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|object site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = Null
// CHECK-NEXT: v19 = Call v3, v2, v17, v18 calleeName="Object.setPrototypeOf"
// CHECK-NEXT: v20 = Builtin builtin=Object
// CHECK-NEXT: v21 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="s644"
// CHECK-NEXT: v24 = ToPropertyKey v23
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v26 = Call v25 calleeName="make644"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_5]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v28 = PropGet v27 key="m644"
// CHECK-NEXT: v29 = NewObject layout=[[L_7]]
// CHECK-NEXT: ElemDefine v29, v24, v28
// CHECK-NEXT: v31 = FinishObject v29
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="s644"
// CHECK-NEXT: v34 = ElemGet v31, v33
// CHECK-NEXT: v35 = Call v21, v20, v34 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v36 = TypeTest v35 testedType=null
// CHECK-NEXT: v37 = Call v0, -, v1, v36 calleeName="say"
// CHECK-NEXT: v38 = Undefined
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c653"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = String string="record/getter-member/set"
// CHECK-NEXT: v2 = NewObject layout=[[L_10]]
// CHECK-NEXT: v3 = NewClosure function=[[f_11]]
// CHECK-NEXT: DefineGetter v2, v3 key="f"
// CHECK-NEXT: v5 = FinishObject v2
// CHECK-NEXT: v6 = PropGet v5 key="f"
// CHECK-NEXT: v7 = NewObject layout=[[L_10]]
// CHECK-NEXT: v8 = NewClosure function=[[f_12]]
// CHECK-NEXT: DefineGetter v7, v8 key="f"
// CHECK-NEXT: v10 = FinishObject v7
// CHECK-NEXT: v11 = PropGet v10 key="f"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = Builtin builtin=Set
// CHECK-NEXT: v14 = Construct v13 calleeName="Set"
// CHECK-NEXT: v15 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v16 = Call v15, v14, v6
// CHECK-NEXT: v17 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v18 = Call v17, v14, v11
// CHECK-NEXT: v19 = Convert v14 declared={type=undefined|null|Set site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v20 = PropGet v19 key="size"
// CHECK-NEXT: v21 = Call v0, -, v1, v20 calleeName="say"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
