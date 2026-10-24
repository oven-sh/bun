// Generated program: object and closure identity stays observable when allocations are removed (part 9).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R541 { a541: number; m541: () => number }
function make541(): R541 { return { a541: 1, m541: () => 1 }; }
const key541: string = "m541";
function c541(): void { say("record/computed-key/strict-eq", ((make541() as any)[key541]) === ((make541() as any)[key541])); }

interface R542 { a542: number; m542: () => number }
function make542(): R542 { return { a542: 1, m542: () => 1 }; }
const key542: string = "m542";
function c542(): void { say("record/computed-key/strict-ne", ((make542() as any)[key542]) !== ((make542() as any)[key542])); }

interface R543 { a543: number; m543: () => number }
function make543(): R543 { return { a543: 1, m543: () => 1 }; }
const key543: string = "m543";
function c543(): void { say("record/computed-key/loose-eq", ((make543() as any)[key543]) == ((make543() as any)[key543])); }

interface R544 { a544: number; m544: () => number }
function make544(): R544 { return { a544: 1, m544: () => 1 }; }
const key544: string = "m544";
function c544(): void { say("record/computed-key/object-is", Object.is(((make544() as any)[key544]), ((make544() as any)[key544]))); }

interface R545 { a545: number; m545: () => number }
function make545(): R545 { return { a545: 1, m545: () => 1 }; }
const key545: string = "m545";
function c545(): void { say("record/computed-key/set", new Set([((make545() as any)[key545]), ((make545() as any)[key545])]).size); }

interface R546 { a546: number; m546: () => number }
function make546(): R546 { return { a546: 1, m546: () => 1 }; }
const key546: string = "m546";
function c546(): void { say("record/computed-key/map-key", new Map([[((make546() as any)[key546]), 1], [((make546() as any)[key546]), 2]]).size); }

interface R547 { a547: number; m547: () => number }
function make547(): R547 { return { a547: 1, m547: () => 1 }; }
const key547: string = "m547";
function c547(): void { say("record/computed-key/includes", [((make547() as any)[key547])].includes(((make547() as any)[key547]))); }

interface R548 { a548: number; m548: () => number }
function make548(): R548 { return { a548: 1, m548: () => 1 }; }
const key548: string = "m548";
function c548(): void { say("record/computed-key/index-of", [((make548() as any)[key548])].indexOf(((make548() as any)[key548]))); }

interface R549 { a549: number; m549: () => number }
function make549(): R549 { return { a549: 1, m549: () => 1 }; }
const key549: string = "m549";
const ws549 = new WeakSet<object>();
function c549(): void { say("record/computed-key/weak-set", (ws549.add(((make549() as any)[key549]) as object), ws549.has(((make549() as any)[key549]) as object))); }

interface R550 { a550: number; m550: () => number }
function make550(): R550 { return { a550: 1, m550: () => 1 }; }
const key550: string = "m550";
const wm550 = new WeakMap<object, number>();
function c550(): void { say("record/computed-key/weak-map", (wm550.set(((make550() as any)[key550]) as object, 1), wm550.has(((make550() as any)[key550]) as object))); }

interface R551 { a551: number; m551: () => number }
function make551(): R551 { return { a551: 1, m551: () => 1 }; }
const key551: string = "m551";
function c551(): void { say("record/computed-key/written", (((((make551() as any)[key551])) as any).tag = 1, ((((make551() as any)[key551])) as any).tag)); }

interface R552 { a552: number; m552: () => number }
function make552(): R552 { return { a552: 1, m552: () => 1 }; }
const key552: string = "m552";
function c552(): void { say("record/computed-key/defined", (Object.defineProperty(((make552() as any)[key552]) as object, "t", { value: 1 }), "t" in (((make552() as any)[key552]) as object))); }

interface R553 { a553: number; m553: () => number }
function make553(): R553 { return { a553: 1, m553: () => 1 }; }
const key553: string = "m553";
function c553(): void { say("record/computed-key/frozen", (Object.freeze(((make553() as any)[key553])), Object.isFrozen(((make553() as any)[key553])))); }

interface R554 { a554: number; m554: () => number }
function make554(): R554 { return { a554: 1, m554: () => 1 }; }
const key554: string = "m554";
function c554(): void { say("record/computed-key/prototype-set", (Object.setPrototypeOf(((make554() as any)[key554]) as object, null), Object.getPrototypeOf(((make554() as any)[key554])) === null)); }

interface R555 { a555: number; m555: () => number }
function make555(): R555 { return { a555: 1, m555: () => 1 }; }
const key555: string = "m555";
function c555(): void { say("record/computed-key/deleted", (delete ((((make555() as any)[key555])) as any).length, Object.hasOwn(((make555() as any)[key555]) as object, "length"))); }

interface R556 { a556: number; m556: () => number }
function make556(): R556 { return { a556: 1, m556: () => 1 }; }
const key556: string = "m556";
function same556(a: unknown, b: unknown): boolean { return a === b; }
function c556(): void { say("record/computed-key/in-a-callee", same556(((make556() as any)[key556]), ((make556() as any)[key556]))); }

interface R557 { a557: number; m557: () => number }
function make557(): R557 { return { a557: 1, m557: () => 1 }; }
const key557: string = "m557";
function hit557(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c557(): void { say("record/computed-key/switch", hit557(((make557() as any)[key557]), ((make557() as any)[key557]))); }

interface R558 { a558: number; m558: () => number }
function make558(): R558 { return { a558: 1, m558: () => 1 }; }
const key558: string = "m558";
let last558: unknown;
function seen558(f: unknown): boolean { const same = f === last558; last558 = f; return same; }
function c558(): void { say("record/computed-key/kept-then-compared", (seen558(((make558() as any)[key558])), seen558(((make558() as any)[key558])))); }

interface R559 { a559: number; m559: () => number }
function make559(): R559 { return { a559: 1, m559: () => 1 }; }
function get559(): unknown { const t = make559(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c559(): void { say("record/for-in/strict-eq", (get559()) === (get559())); }

interface R560 { a560: number; m560: () => number }
function make560(): R560 { return { a560: 1, m560: () => 1 }; }
function get560(): unknown { const t = make560(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c560(): void { say("record/for-in/strict-ne", (get560()) !== (get560())); }

interface R561 { a561: number; m561: () => number }
function make561(): R561 { return { a561: 1, m561: () => 1 }; }
function get561(): unknown { const t = make561(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c561(): void { say("record/for-in/loose-eq", (get561()) == (get561())); }

interface R562 { a562: number; m562: () => number }
function make562(): R562 { return { a562: 1, m562: () => 1 }; }
function get562(): unknown { const t = make562(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c562(): void { say("record/for-in/object-is", Object.is((get562()), (get562()))); }

interface R563 { a563: number; m563: () => number }
function make563(): R563 { return { a563: 1, m563: () => 1 }; }
function get563(): unknown { const t = make563(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c563(): void { say("record/for-in/set", new Set([(get563()), (get563())]).size); }

interface R564 { a564: number; m564: () => number }
function make564(): R564 { return { a564: 1, m564: () => 1 }; }
function get564(): unknown { const t = make564(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c564(): void { say("record/for-in/map-key", new Map([[(get564()), 1], [(get564()), 2]]).size); }

interface R565 { a565: number; m565: () => number }
function make565(): R565 { return { a565: 1, m565: () => 1 }; }
function get565(): unknown { const t = make565(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c565(): void { say("record/for-in/includes", [(get565())].includes((get565()))); }

interface R566 { a566: number; m566: () => number }
function make566(): R566 { return { a566: 1, m566: () => 1 }; }
function get566(): unknown { const t = make566(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c566(): void { say("record/for-in/index-of", [(get566())].indexOf((get566()))); }

interface R567 { a567: number; m567: () => number }
function make567(): R567 { return { a567: 1, m567: () => 1 }; }
function get567(): unknown { const t = make567(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
const ws567 = new WeakSet<object>();
function c567(): void { say("record/for-in/weak-set", (ws567.add((get567()) as object), ws567.has((get567()) as object))); }

interface R568 { a568: number; m568: () => number }
function make568(): R568 { return { a568: 1, m568: () => 1 }; }
function get568(): unknown { const t = make568(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
const wm568 = new WeakMap<object, number>();
function c568(): void { say("record/for-in/weak-map", (wm568.set((get568()) as object, 1), wm568.has((get568()) as object))); }

interface R569 { a569: number; m569: () => number }
function make569(): R569 { return { a569: 1, m569: () => 1 }; }
function get569(): unknown { const t = make569(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c569(): void { say("record/for-in/written", ((((get569())) as any).tag = 1, (((get569())) as any).tag)); }

interface R570 { a570: number; m570: () => number }
function make570(): R570 { return { a570: 1, m570: () => 1 }; }
function get570(): unknown { const t = make570(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c570(): void { say("record/for-in/defined", (Object.defineProperty((get570()) as object, "t", { value: 1 }), "t" in ((get570()) as object))); }

interface R571 { a571: number; m571: () => number }
function make571(): R571 { return { a571: 1, m571: () => 1 }; }
function get571(): unknown { const t = make571(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c571(): void { say("record/for-in/frozen", (Object.freeze((get571())), Object.isFrozen((get571())))); }

interface R572 { a572: number; m572: () => number }
function make572(): R572 { return { a572: 1, m572: () => 1 }; }
function get572(): unknown { const t = make572(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c572(): void { say("record/for-in/prototype-set", (Object.setPrototypeOf((get572()) as object, null), Object.getPrototypeOf((get572())) === null)); }

interface R573 { a573: number; m573: () => number }
function make573(): R573 { return { a573: 1, m573: () => 1 }; }
function get573(): unknown { const t = make573(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c573(): void { say("record/for-in/deleted", (delete (((get573())) as any).length, Object.hasOwn((get573()) as object, "length"))); }

interface R574 { a574: number; m574: () => number }
function make574(): R574 { return { a574: 1, m574: () => 1 }; }
function get574(): unknown { const t = make574(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function same574(a: unknown, b: unknown): boolean { return a === b; }
function c574(): void { say("record/for-in/in-a-callee", same574((get574()), (get574()))); }

interface R575 { a575: number; m575: () => number }
function make575(): R575 { return { a575: 1, m575: () => 1 }; }
function get575(): unknown { const t = make575(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function hit575(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c575(): void { say("record/for-in/switch", hit575((get575()), (get575()))); }

interface R576 { a576: number; m576: () => number }
function make576(): R576 { return { a576: 1, m576: () => 1 }; }
function get576(): unknown { const t = make576(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
let last576: unknown;
function seen576(f: unknown): boolean { const same = f === last576; last576 = f; return same; }
function c576(): void { say("record/for-in/kept-then-compared", (seen576((get576())), seen576((get576())))); }

interface R577 { a577: number; m577: () => number }
interface O577 { in577: R577; n577: number }
function make577(): O577 { return { in577: { a577: 1, m577: () => 1 }, n577: 2 }; }
function c577(): void { say("nested/inline/strict-eq", (make577().in577.m577) === (make577().in577.m577)); }

interface R578 { a578: number; m578: () => number }
interface O578 { in578: R578; n578: number }
function make578(): O578 { return { in578: { a578: 1, m578: () => 1 }, n578: 2 }; }
function get578(): unknown { return make578().in578.m578; }
function c578(): void { say("nested/getter/strict-eq", (get578()) === (get578())); }

interface R579 { a579: number; m579: () => number }
interface O579 { in579: R579; n579: number }
function make579(): O579 { return { in579: { a579: 1, m579: () => 1 }, n579: 2 }; }
function get579a(): unknown { return make579().in579.m579; }
function get579b(): unknown { return get579a(); }
function get579(): unknown { return get579b(); }
function c579(): void { say("nested/forwarded/strict-eq", (get579()) === (get579())); }

interface R580 { a580: number; m580: () => number }
interface O580 { in580: R580; n580: number }
function make580(): O580 { return { in580: { a580: 1, m580: () => 1 }, n580: 2 }; }
function pick580(x: O580): unknown { return x.in580.m580; }
function c580(): void { say("nested/picked/strict-eq", (pick580(make580())) === (pick580(make580()))); }

interface R581 { a581: number; m581: () => number }
interface O581 { in581: R581; n581: number }
function make581(): O581 { return { in581: { a581: 1, m581: () => 1 }, n581: 2 }; }
function pick581(x: O581): unknown { return x.in581.m581; }
function get581(): unknown { return pick581(make581()); }
function c581(): void { say("nested/picked-and-returned/strict-eq", (get581()) === (get581())); }

interface R582 { a582: number; m582: () => number }
interface O582 { in582: R582; n582: number }
function make582(): O582 { return { in582: { a582: 1, m582: () => 1 }, n582: 2 }; }
let slot582: unknown;
function put582(): unknown { slot582 = make582().in582.m582; return 0; }
function c582(): void { say("nested/variable/strict-eq", ((put582(), slot582)) === ((put582(), slot582))); }

interface R583 { a583: number; m583: () => number }
interface O583 { in583: R583; n583: number }
function make583(): O583 { return { in583: { a583: 1, m583: () => 1 }, n583: 2 }; }
let kept583: O583 | undefined;
function keep583(): unknown { kept583 = make583(); return 0; }
function c583(): void { say("nested/holder-in-a-variable/strict-eq", ((keep583(), kept583!.in583.m583)) === ((keep583(), kept583!.in583.m583))); }

interface R584 { a584: number; m584: () => number }
interface O584 { in584: R584; n584: number }
function make584(): O584 { return { in584: { a584: 1, m584: () => 1 }, n584: 2 }; }
function with584<T>(k: (f: unknown) => T): T { return k(make584().in584.m584); }
function c584(): void { say("nested/callback/strict-eq", (with584(x => x)) === (with584(x => x))); }

interface R585 { a585: number; m585: () => number }
interface O585 { in585: R585; n585: number }
function make585(): O585 { return { in585: { a585: 1, m585: () => 1 }, n585: 2 }; }
function later585(): () => unknown { const t = make585(); return () => t.in585.m585; }
function c585(): void { say("nested/closure/strict-eq", (later585()()) === (later585()())); }

interface R586 { a586: number; m586: () => number }
interface O586 { in586: R586; n586: number }
function make586(): O586 { return { in586: { a586: 1, m586: () => 1 }, n586: 2 }; }
function later586(): () => unknown { const f = make586().in586.m586; return () => f; }
function c586(): void { say("nested/captured/strict-eq", (later586()()) === (later586()())); }

interface R587 { a587: number; m587: () => number }
interface O587 { in587: R587; n587: number }
function make587(): O587 { return { in587: { a587: 1, m587: () => 1 }, n587: 2 }; }
function wrap587(): { f: unknown } { return { f: make587().in587.m587 }; }
function c587(): void { say("nested/rewrapped/strict-eq", (wrap587().f) === (wrap587().f)); }

interface R588 { a588: number; m588: () => number }
interface O588 { in588: R588; n588: number }
function make588(): O588 { return { in588: { a588: 1, m588: () => 1 }, n588: 2 }; }
function wrap588(): unknown[] { return [make588().in588.m588]; }
function c588(): void { say("nested/rewrapped-in-an-array/strict-eq", (wrap588()[0]) === (wrap588()[0])); }

interface R589 { a589: number; m589: () => number }
interface O589 { in589: R589; n589: number }
function make589(): O589 { return { in589: { a589: 1, m589: () => 1 }, n589: 2 }; }
function* gen589(): Generator<unknown> { yield make589().in589.m589; }
function c589(): void { say("nested/generator/strict-eq", (gen589().next().value) === (gen589().next().value)); }

interface R590 { a590: number; m590: () => number }
interface O590 { in590: R590; n590: number }
function make590(): O590 { return { in590: { a590: 1, m590: () => 1 }, n590: 2 }; }
class K590 { get(): unknown { return make590().in590.m590; } }
function c590(): void { say("nested/method/strict-eq", (new K590().get()) === (new K590().get())); }

interface R591 { a591: number; m591: () => number }
interface O591 { in591: R591; n591: number }
function make591(): O591 { return { in591: { a591: 1, m591: () => 1 }, n591: 2 }; }
class K591 { get f(): unknown { return make591().in591.m591; } }
function c591(): void { say("nested/accessor/strict-eq", (new K591().f) === (new K591().f)); }

interface R592 { a592: number; m592: () => number }
interface O592 { in592: R592; n592: number }
function make592(): O592 { return { in592: { a592: 1, m592: () => 1 }, n592: 2 }; }
function first592(...xs: unknown[]): unknown { return xs[0]; }
function c592(): void { say("nested/rest/strict-eq", (first592(make592().in592.m592)) === (first592(make592().in592.m592))); }

interface R593 { a593: number; m593: () => number }
interface O593 { in593: R593; n593: number }
function make593(): O593 { return { in593: { a593: 1, m593: () => 1 }, n593: 2 }; }
function get593(): unknown { try { throw make593().in593.m593; } catch (e) { return e; } }
function c593(): void { say("nested/thrown/strict-eq", (get593()) === (get593())); }

interface R594 { a594: number; m594: () => number }
interface O594 { in594: R594; n594: number }
function make594(): O594 { return { in594: { a594: 1, m594: () => 1 }, n594: 2 }; }
function get594(other: unknown, which: boolean): unknown { return which ? make594().in594.m594 : other; }
function c594(): void { say("nested/one-arm/strict-eq", (get594(0, true)) === (get594(0, true))); }

interface R595 { a595: number; m595: () => number }
interface O595 { in595: R595; n595: number }
function make595(): O595 { return { in595: { a595: 1, m595: () => 1 }, n595: 2 }; }
function get595(): unknown { let t = make595(); for (let i = 0; i < 2; i++) t = make595(); return t.in595.m595; }
function c595(): void { say("nested/loop/strict-eq", (get595()) === (get595())); }

interface R596 { a596: number; m596: () => number }
interface O596 { in596: R596; n596: number }
function make596(): O596 { return { in596: { a596: 1, m596: () => 1 }, n596: 2 }; }
function id596<T>(x: T): T { return x; }
function get596(): unknown { return id596(make596()).in596.m596; }
function c596(): void { say("nested/identity/strict-eq", (get596()) === (get596())); }

interface R597 { a597: number; m597: () => number }
interface O597 { in597: R597; n597: number }
function make597(): O597 { return { in597: { a597: 1, m597: () => 1 }, n597: 2 }; }
function get597(): unknown { return make597().in597.m597; }
const g597 = [get597];
function c597(): void { say("nested/by-value/strict-eq", (g597[0]()) === (g597[0]())); }

interface R609 { a609: number; m609: () => number }
interface O609 { in609: R609; n609: number }
function make609(): O609 { return { in609: { a609: 1, m609: () => 1 }, n609: 2 }; }
function get609(): unknown { return make609().in609.m609; }
function c609(): void { say("nested/getter/strict-ne", (get609()) !== (get609())); }

interface R610 { a610: number; m610: () => number }
interface O610 { in610: R610; n610: number }
function make610(): O610 { return { in610: { a610: 1, m610: () => 1 }, n610: 2 }; }
function get610(): unknown { return make610().in610.m610; }
function c610(): void { say("nested/getter/loose-eq", (get610()) == (get610())); }

interface R611 { a611: number; m611: () => number }
interface O611 { in611: R611; n611: number }
function make611(): O611 { return { in611: { a611: 1, m611: () => 1 }, n611: 2 }; }
function get611(): unknown { return make611().in611.m611; }
function c611(): void { say("nested/getter/object-is", Object.is((get611()), (get611()))); }

c541(); c542(); c543(); c544(); c545(); c546(); c547(); c548(); c549(); c550(); c551(); c552(); c553(); c554(); c555(); c556(); c557(); c558(); c559(); c560(); c561(); c562(); c563(); c564(); c565(); c566(); c567(); c568(); c569(); c570(); c571(); c572(); c573(); c574(); c575(); c576(); c577(); c578(); c579(); c580(); c581(); c582(); c583(); c584(); c585(); c586(); c587(); c588(); c589(); c590(); c591(); c592(); c593(); c594(); c595(); c596(); c597(); c609(); c610(); c611();
console.log(out.join("\n"));
