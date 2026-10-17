// Generated program: object and closure identity stays observable when allocations are removed (second series, part 12).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R721 { a721: number; m721: () => number }
function make721(): R721 { return { a721: 1, m721: () => 1 }; }
function get721(_x: unknown): unknown { return arguments[0]; }
function c721(): void { say("record/arguments-object/strict-eq", (get721(make721().m721)) === (get721(make721().m721))); }

interface R722 { a722: number; m722: () => number }
function make722(): R722 { return { a722: 1, m722: () => 1 }; }
function get722(_x: unknown): unknown { return arguments[0]; }
function c722(): void { say("record/arguments-object/strict-ne", (get722(make722().m722)) !== (get722(make722().m722))); }

interface R723 { a723: number; m723: () => number }
function make723(): R723 { return { a723: 1, m723: () => 1 }; }
function get723(_x: unknown): unknown { return arguments[0]; }
function c723(): void { say("record/arguments-object/loose-eq", (get723(make723().m723)) == (get723(make723().m723))); }

interface R724 { a724: number; m724: () => number }
function make724(): R724 { return { a724: 1, m724: () => 1 }; }
function get724(_x: unknown): unknown { return arguments[0]; }
function c724(): void { say("record/arguments-object/object-is", Object.is((get724(make724().m724)), (get724(make724().m724)))); }

interface R725 { a725: number; m725: () => number }
function make725(): R725 { return { a725: 1, m725: () => 1 }; }
function get725(_x: unknown): unknown { return arguments[0]; }
function c725(): void { say("record/arguments-object/set", new Set([(get725(make725().m725)), (get725(make725().m725))]).size); }

interface R726 { a726: number; m726: () => number }
function make726(): R726 { return { a726: 1, m726: () => 1 }; }
function get726(_x: unknown): unknown { return arguments[0]; }
function c726(): void { say("record/arguments-object/map-key", new Map([[(get726(make726().m726)), 1], [(get726(make726().m726)), 2]]).size); }

interface R727 { a727: number; m727: () => number }
function make727(): R727 { return { a727: 1, m727: () => 1 }; }
function get727(_x: unknown): unknown { return arguments[0]; }
function c727(): void { say("record/arguments-object/includes", [(get727(make727().m727))].includes((get727(make727().m727)))); }

interface R728 { a728: number; m728: () => number }
function make728(): R728 { return { a728: 1, m728: () => 1 }; }
function get728(_x: unknown): unknown { return arguments[0]; }
function c728(): void { say("record/arguments-object/index-of", [(get728(make728().m728))].indexOf((get728(make728().m728)))); }

interface R729 { a729: number; m729: () => number }
function make729(): R729 { return { a729: 1, m729: () => 1 }; }
function get729(_x: unknown): unknown { return arguments[0]; }
const ws729 = new WeakSet<object>();
function c729(): void { say("record/arguments-object/weak-set", (ws729.add((get729(make729().m729)) as object), ws729.has((get729(make729().m729)) as object))); }

interface R730 { a730: number; m730: () => number }
function make730(): R730 { return { a730: 1, m730: () => 1 }; }
function get730(_x: unknown): unknown { return arguments[0]; }
const wm730 = new WeakMap<object, number>();
function c730(): void { say("record/arguments-object/weak-map", (wm730.set((get730(make730().m730)) as object, 1), wm730.has((get730(make730().m730)) as object))); }

interface R731 { a731: number; m731: () => number }
function make731(): R731 { return { a731: 1, m731: () => 1 }; }
function get731(_x: unknown): unknown { return arguments[0]; }
function c731(): void { say("record/arguments-object/written", ((((get731(make731().m731))) as any).tag = 1, (((get731(make731().m731))) as any).tag)); }

interface R732 { a732: number; m732: () => number }
function make732(): R732 { return { a732: 1, m732: () => 1 }; }
function get732(_x: unknown): unknown { return arguments[0]; }
function c732(): void { say("record/arguments-object/defined", (Object.defineProperty((get732(make732().m732)) as object, "t", { value: 1 }), "t" in ((get732(make732().m732)) as object))); }

interface R733 { a733: number; m733: () => number }
function make733(): R733 { return { a733: 1, m733: () => 1 }; }
function get733(_x: unknown): unknown { return arguments[0]; }
function c733(): void { say("record/arguments-object/frozen", (Object.freeze((get733(make733().m733))), Object.isFrozen((get733(make733().m733))))); }

interface R734 { a734: number; m734: () => number }
function make734(): R734 { return { a734: 1, m734: () => 1 }; }
function get734(_x: unknown): unknown { return arguments[0]; }
function c734(): void { say("record/arguments-object/prototype-set", (Object.setPrototypeOf((get734(make734().m734)) as object, null), Object.getPrototypeOf((get734(make734().m734))) === null)); }

interface R735 { a735: number; m735: () => number }
function make735(): R735 { return { a735: 1, m735: () => 1 }; }
function get735(_x: unknown): unknown { return arguments[0]; }
function c735(): void { say("record/arguments-object/deleted", (delete (((get735(make735().m735))) as any).length, Object.hasOwn((get735(make735().m735)) as object, "length"))); }

interface R736 { a736: number; m736: () => number }
function make736(): R736 { return { a736: 1, m736: () => 1 }; }
function get736(_x: unknown): unknown { return arguments[0]; }
function same736(a: unknown, b: unknown): boolean { return a === b; }
function c736(): void { say("record/arguments-object/in-a-callee", same736((get736(make736().m736)), (get736(make736().m736)))); }

interface R737 { a737: number; m737: () => number }
function make737(): R737 { return { a737: 1, m737: () => 1 }; }
function get737(_x: unknown): unknown { return arguments[0]; }
function hit737(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c737(): void { say("record/arguments-object/switch", hit737((get737(make737().m737)), (get737(make737().m737)))); }

interface R738 { a738: number; m738: () => number }
function make738(): R738 { return { a738: 1, m738: () => 1 }; }
function get738(_x: unknown): unknown { return arguments[0]; }
let last738: unknown;
function seen738(f: unknown): boolean { const same = f === last738; last738 = f; return same; }
function c738(): void { say("record/arguments-object/kept-then-compared", (seen738((get738(make738().m738))), seen738((get738(make738().m738))))); }

interface R739 { a739: number; m739: () => number }
function make739(): R739 { return { a739: 1, m739: () => 1 }; }
function get739(n: number): unknown { return n === 0 ? make739().m739 : get739(n - 1); }
function c739(): void { say("record/recursion/strict-eq", (get739(2)) === (get739(2))); }

interface R740 { a740: number; m740: () => number }
function make740(): R740 { return { a740: 1, m740: () => 1 }; }
function get740(n: number): unknown { return n === 0 ? make740().m740 : get740(n - 1); }
function c740(): void { say("record/recursion/strict-ne", (get740(2)) !== (get740(2))); }

interface R741 { a741: number; m741: () => number }
function make741(): R741 { return { a741: 1, m741: () => 1 }; }
function get741(n: number): unknown { return n === 0 ? make741().m741 : get741(n - 1); }
function c741(): void { say("record/recursion/loose-eq", (get741(2)) == (get741(2))); }

interface R742 { a742: number; m742: () => number }
function make742(): R742 { return { a742: 1, m742: () => 1 }; }
function get742(n: number): unknown { return n === 0 ? make742().m742 : get742(n - 1); }
function c742(): void { say("record/recursion/object-is", Object.is((get742(2)), (get742(2)))); }

interface R743 { a743: number; m743: () => number }
function make743(): R743 { return { a743: 1, m743: () => 1 }; }
function get743(n: number): unknown { return n === 0 ? make743().m743 : get743(n - 1); }
function c743(): void { say("record/recursion/set", new Set([(get743(2)), (get743(2))]).size); }

interface R744 { a744: number; m744: () => number }
function make744(): R744 { return { a744: 1, m744: () => 1 }; }
function get744(n: number): unknown { return n === 0 ? make744().m744 : get744(n - 1); }
function c744(): void { say("record/recursion/map-key", new Map([[(get744(2)), 1], [(get744(2)), 2]]).size); }

interface R745 { a745: number; m745: () => number }
function make745(): R745 { return { a745: 1, m745: () => 1 }; }
function get745(n: number): unknown { return n === 0 ? make745().m745 : get745(n - 1); }
function c745(): void { say("record/recursion/includes", [(get745(2))].includes((get745(2)))); }

interface R746 { a746: number; m746: () => number }
function make746(): R746 { return { a746: 1, m746: () => 1 }; }
function get746(n: number): unknown { return n === 0 ? make746().m746 : get746(n - 1); }
function c746(): void { say("record/recursion/index-of", [(get746(2))].indexOf((get746(2)))); }

interface R747 { a747: number; m747: () => number }
function make747(): R747 { return { a747: 1, m747: () => 1 }; }
function get747(n: number): unknown { return n === 0 ? make747().m747 : get747(n - 1); }
const ws747 = new WeakSet<object>();
function c747(): void { say("record/recursion/weak-set", (ws747.add((get747(2)) as object), ws747.has((get747(2)) as object))); }

interface R748 { a748: number; m748: () => number }
function make748(): R748 { return { a748: 1, m748: () => 1 }; }
function get748(n: number): unknown { return n === 0 ? make748().m748 : get748(n - 1); }
const wm748 = new WeakMap<object, number>();
function c748(): void { say("record/recursion/weak-map", (wm748.set((get748(2)) as object, 1), wm748.has((get748(2)) as object))); }

interface R749 { a749: number; m749: () => number }
function make749(): R749 { return { a749: 1, m749: () => 1 }; }
function get749(n: number): unknown { return n === 0 ? make749().m749 : get749(n - 1); }
function c749(): void { say("record/recursion/written", ((((get749(2))) as any).tag = 1, (((get749(2))) as any).tag)); }

interface R750 { a750: number; m750: () => number }
function make750(): R750 { return { a750: 1, m750: () => 1 }; }
function get750(n: number): unknown { return n === 0 ? make750().m750 : get750(n - 1); }
function c750(): void { say("record/recursion/defined", (Object.defineProperty((get750(2)) as object, "t", { value: 1 }), "t" in ((get750(2)) as object))); }

interface R751 { a751: number; m751: () => number }
function make751(): R751 { return { a751: 1, m751: () => 1 }; }
function get751(n: number): unknown { return n === 0 ? make751().m751 : get751(n - 1); }
function c751(): void { say("record/recursion/frozen", (Object.freeze((get751(2))), Object.isFrozen((get751(2))))); }

interface R752 { a752: number; m752: () => number }
function make752(): R752 { return { a752: 1, m752: () => 1 }; }
function get752(n: number): unknown { return n === 0 ? make752().m752 : get752(n - 1); }
function c752(): void { say("record/recursion/prototype-set", (Object.setPrototypeOf((get752(2)) as object, null), Object.getPrototypeOf((get752(2))) === null)); }

interface R753 { a753: number; m753: () => number }
function make753(): R753 { return { a753: 1, m753: () => 1 }; }
function get753(n: number): unknown { return n === 0 ? make753().m753 : get753(n - 1); }
function c753(): void { say("record/recursion/deleted", (delete (((get753(2))) as any).length, Object.hasOwn((get753(2)) as object, "length"))); }

interface R754 { a754: number; m754: () => number }
function make754(): R754 { return { a754: 1, m754: () => 1 }; }
function get754(n: number): unknown { return n === 0 ? make754().m754 : get754(n - 1); }
function same754(a: unknown, b: unknown): boolean { return a === b; }
function c754(): void { say("record/recursion/in-a-callee", same754((get754(2)), (get754(2)))); }

interface R755 { a755: number; m755: () => number }
function make755(): R755 { return { a755: 1, m755: () => 1 }; }
function get755(n: number): unknown { return n === 0 ? make755().m755 : get755(n - 1); }
function hit755(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c755(): void { say("record/recursion/switch", hit755((get755(2)), (get755(2)))); }

interface R756 { a756: number; m756: () => number }
function make756(): R756 { return { a756: 1, m756: () => 1 }; }
function get756(n: number): unknown { return n === 0 ? make756().m756 : get756(n - 1); }
let last756: unknown;
function seen756(f: unknown): boolean { const same = f === last756; last756 = f; return same; }
function c756(): void { say("record/recursion/kept-then-compared", (seen756((get756(2))), seen756((get756(2))))); }

interface R757 { a757: number; m757: () => number }
function make757(): R757 { return { a757: 1, m757: () => 1 }; }
function even757(n: number): unknown { return n === 0 ? make757().m757 : odd757(n - 1); }
function odd757(n: number): unknown { return even757(n - 1); }
function c757(): void { say("record/mutual-recursion/strict-eq", (even757(2)) === (even757(2))); }

interface R758 { a758: number; m758: () => number }
function make758(): R758 { return { a758: 1, m758: () => 1 }; }
function even758(n: number): unknown { return n === 0 ? make758().m758 : odd758(n - 1); }
function odd758(n: number): unknown { return even758(n - 1); }
function c758(): void { say("record/mutual-recursion/strict-ne", (even758(2)) !== (even758(2))); }

interface R759 { a759: number; m759: () => number }
function make759(): R759 { return { a759: 1, m759: () => 1 }; }
function even759(n: number): unknown { return n === 0 ? make759().m759 : odd759(n - 1); }
function odd759(n: number): unknown { return even759(n - 1); }
function c759(): void { say("record/mutual-recursion/loose-eq", (even759(2)) == (even759(2))); }

interface R760 { a760: number; m760: () => number }
function make760(): R760 { return { a760: 1, m760: () => 1 }; }
function even760(n: number): unknown { return n === 0 ? make760().m760 : odd760(n - 1); }
function odd760(n: number): unknown { return even760(n - 1); }
function c760(): void { say("record/mutual-recursion/object-is", Object.is((even760(2)), (even760(2)))); }

interface R761 { a761: number; m761: () => number }
function make761(): R761 { return { a761: 1, m761: () => 1 }; }
function even761(n: number): unknown { return n === 0 ? make761().m761 : odd761(n - 1); }
function odd761(n: number): unknown { return even761(n - 1); }
function c761(): void { say("record/mutual-recursion/set", new Set([(even761(2)), (even761(2))]).size); }

interface R762 { a762: number; m762: () => number }
function make762(): R762 { return { a762: 1, m762: () => 1 }; }
function even762(n: number): unknown { return n === 0 ? make762().m762 : odd762(n - 1); }
function odd762(n: number): unknown { return even762(n - 1); }
function c762(): void { say("record/mutual-recursion/map-key", new Map([[(even762(2)), 1], [(even762(2)), 2]]).size); }

interface R763 { a763: number; m763: () => number }
function make763(): R763 { return { a763: 1, m763: () => 1 }; }
function even763(n: number): unknown { return n === 0 ? make763().m763 : odd763(n - 1); }
function odd763(n: number): unknown { return even763(n - 1); }
function c763(): void { say("record/mutual-recursion/includes", [(even763(2))].includes((even763(2)))); }

interface R764 { a764: number; m764: () => number }
function make764(): R764 { return { a764: 1, m764: () => 1 }; }
function even764(n: number): unknown { return n === 0 ? make764().m764 : odd764(n - 1); }
function odd764(n: number): unknown { return even764(n - 1); }
function c764(): void { say("record/mutual-recursion/index-of", [(even764(2))].indexOf((even764(2)))); }

interface R765 { a765: number; m765: () => number }
function make765(): R765 { return { a765: 1, m765: () => 1 }; }
function even765(n: number): unknown { return n === 0 ? make765().m765 : odd765(n - 1); }
function odd765(n: number): unknown { return even765(n - 1); }
const ws765 = new WeakSet<object>();
function c765(): void { say("record/mutual-recursion/weak-set", (ws765.add((even765(2)) as object), ws765.has((even765(2)) as object))); }

interface R766 { a766: number; m766: () => number }
function make766(): R766 { return { a766: 1, m766: () => 1 }; }
function even766(n: number): unknown { return n === 0 ? make766().m766 : odd766(n - 1); }
function odd766(n: number): unknown { return even766(n - 1); }
const wm766 = new WeakMap<object, number>();
function c766(): void { say("record/mutual-recursion/weak-map", (wm766.set((even766(2)) as object, 1), wm766.has((even766(2)) as object))); }

interface R767 { a767: number; m767: () => number }
function make767(): R767 { return { a767: 1, m767: () => 1 }; }
function even767(n: number): unknown { return n === 0 ? make767().m767 : odd767(n - 1); }
function odd767(n: number): unknown { return even767(n - 1); }
function c767(): void { say("record/mutual-recursion/written", ((((even767(2))) as any).tag = 1, (((even767(2))) as any).tag)); }

interface R768 { a768: number; m768: () => number }
function make768(): R768 { return { a768: 1, m768: () => 1 }; }
function even768(n: number): unknown { return n === 0 ? make768().m768 : odd768(n - 1); }
function odd768(n: number): unknown { return even768(n - 1); }
function c768(): void { say("record/mutual-recursion/defined", (Object.defineProperty((even768(2)) as object, "t", { value: 1 }), "t" in ((even768(2)) as object))); }

interface R769 { a769: number; m769: () => number }
function make769(): R769 { return { a769: 1, m769: () => 1 }; }
function even769(n: number): unknown { return n === 0 ? make769().m769 : odd769(n - 1); }
function odd769(n: number): unknown { return even769(n - 1); }
function c769(): void { say("record/mutual-recursion/frozen", (Object.freeze((even769(2))), Object.isFrozen((even769(2))))); }

interface R770 { a770: number; m770: () => number }
function make770(): R770 { return { a770: 1, m770: () => 1 }; }
function even770(n: number): unknown { return n === 0 ? make770().m770 : odd770(n - 1); }
function odd770(n: number): unknown { return even770(n - 1); }
function c770(): void { say("record/mutual-recursion/prototype-set", (Object.setPrototypeOf((even770(2)) as object, null), Object.getPrototypeOf((even770(2))) === null)); }

interface R771 { a771: number; m771: () => number }
function make771(): R771 { return { a771: 1, m771: () => 1 }; }
function even771(n: number): unknown { return n === 0 ? make771().m771 : odd771(n - 1); }
function odd771(n: number): unknown { return even771(n - 1); }
function c771(): void { say("record/mutual-recursion/deleted", (delete (((even771(2))) as any).length, Object.hasOwn((even771(2)) as object, "length"))); }

interface R772 { a772: number; m772: () => number }
function make772(): R772 { return { a772: 1, m772: () => 1 }; }
function even772(n: number): unknown { return n === 0 ? make772().m772 : odd772(n - 1); }
function odd772(n: number): unknown { return even772(n - 1); }
function same772(a: unknown, b: unknown): boolean { return a === b; }
function c772(): void { say("record/mutual-recursion/in-a-callee", same772((even772(2)), (even772(2)))); }

interface R773 { a773: number; m773: () => number }
function make773(): R773 { return { a773: 1, m773: () => 1 }; }
function even773(n: number): unknown { return n === 0 ? make773().m773 : odd773(n - 1); }
function odd773(n: number): unknown { return even773(n - 1); }
function hit773(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c773(): void { say("record/mutual-recursion/switch", hit773((even773(2)), (even773(2)))); }

interface R774 { a774: number; m774: () => number }
function make774(): R774 { return { a774: 1, m774: () => 1 }; }
function even774(n: number): unknown { return n === 0 ? make774().m774 : odd774(n - 1); }
function odd774(n: number): unknown { return even774(n - 1); }
let last774: unknown;
function seen774(f: unknown): boolean { const same = f === last774; last774 = f; return same; }
function c774(): void { say("record/mutual-recursion/kept-then-compared", (seen774((even774(2))), seen774((even774(2))))); }

interface R775 { a775: number; m775: () => number }
function make775(): R775 { return { a775: 1, m775: () => 1 }; }
function again775(): R775 { return make775(); }
function c775(): void { say("record/maker-forwarded/strict-eq", (again775().m775) === (again775().m775)); }

interface R776 { a776: number; m776: () => number }
function make776(): R776 { return { a776: 1, m776: () => 1 }; }
function again776(): R776 { return make776(); }
function c776(): void { say("record/maker-forwarded/strict-ne", (again776().m776) !== (again776().m776)); }

interface R777 { a777: number; m777: () => number }
function make777(): R777 { return { a777: 1, m777: () => 1 }; }
function again777(): R777 { return make777(); }
function c777(): void { say("record/maker-forwarded/loose-eq", (again777().m777) == (again777().m777)); }

interface R778 { a778: number; m778: () => number }
function make778(): R778 { return { a778: 1, m778: () => 1 }; }
function again778(): R778 { return make778(); }
function c778(): void { say("record/maker-forwarded/object-is", Object.is((again778().m778), (again778().m778))); }

interface R779 { a779: number; m779: () => number }
function make779(): R779 { return { a779: 1, m779: () => 1 }; }
function again779(): R779 { return make779(); }
function c779(): void { say("record/maker-forwarded/set", new Set([(again779().m779), (again779().m779)]).size); }

interface R780 { a780: number; m780: () => number }
function make780(): R780 { return { a780: 1, m780: () => 1 }; }
function again780(): R780 { return make780(); }
function c780(): void { say("record/maker-forwarded/map-key", new Map([[(again780().m780), 1], [(again780().m780), 2]]).size); }

c721(); c722(); c723(); c724(); c725(); c726(); c727(); c728(); c729(); c730(); c731(); c732(); c733(); c734(); c735(); c736(); c737(); c738(); c739(); c740(); c741(); c742(); c743(); c744(); c745(); c746(); c747(); c748(); c749(); c750(); c751(); c752(); c753(); c754(); c755(); c756(); c757(); c758(); c759(); c760(); c761(); c762(); c763(); c764(); c765(); c766(); c767(); c768(); c769(); c770(); c771(); c772(); c773(); c774(); c775(); c776(); c777(); c778(); c779(); c780();
console.log(out.join("\n"));
