// Generated program: object and closure identity stays observable when allocations are removed (part 12).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

function make765(): () => number { return () => 1; }
function get765(): unknown { return make765(); }
function c765(): void { say("bare/getter/written", ((((get765())) as any).tag = 1, (((get765())) as any).tag)); }

function make766(): () => number { return () => 1; }
function get766(): unknown { return make766(); }
function c766(): void { say("bare/getter/defined", (Object.defineProperty((get766()) as object, "t", { value: 1 }), "t" in ((get766()) as object))); }

function make767(): () => number { return () => 1; }
function get767(): unknown { return make767(); }
function c767(): void { say("bare/getter/frozen", (Object.freeze((get767())), Object.isFrozen((get767())))); }

function make768(): () => number { return () => 1; }
function get768(): unknown { return make768(); }
function c768(): void { say("bare/getter/prototype-set", (Object.setPrototypeOf((get768()) as object, null), Object.getPrototypeOf((get768())) === null)); }

function make769(): () => number { return () => 1; }
function get769(): unknown { return make769(); }
function c769(): void { say("bare/getter/deleted", (delete (((get769())) as any).length, Object.hasOwn((get769()) as object, "length"))); }

function make770(): () => number { return () => 1; }
function get770(): unknown { return make770(); }
function same770(a: unknown, b: unknown): boolean { return a === b; }
function c770(): void { say("bare/getter/in-a-callee", same770((get770()), (get770()))); }

function make771(): () => number { return () => 1; }
function get771(): unknown { return make771(); }
function hit771(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c771(): void { say("bare/getter/switch", hit771((get771()), (get771()))); }

function make772(): () => number { return () => 1; }
function get772(): unknown { return make772(); }
let last772: unknown;
function seen772(f: unknown): boolean { const same = f === last772; last772 = f; return same; }
function c772(): void { say("bare/getter/kept-then-compared", (seen772((get772())), seen772((get772())))); }

function make773(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c773(): void { say("map/inline/strict-eq", (make773().get("k")) === (make773().get("k"))); }

function make774(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get774(): unknown { return make774().get("k"); }
function c774(): void { say("map/getter/strict-eq", (get774()) === (get774())); }

function make775(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get775a(): unknown { return make775().get("k"); }
function get775b(): unknown { return get775a(); }
function get775(): unknown { return get775b(); }
function c775(): void { say("map/forwarded/strict-eq", (get775()) === (get775())); }

function make776(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function pick776(x: Map<string, () => number>): unknown { return x.get("k"); }
function c776(): void { say("map/picked/strict-eq", (pick776(make776())) === (pick776(make776()))); }

function make777(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function pick777(x: Map<string, () => number>): unknown { return x.get("k"); }
function get777(): unknown { return pick777(make777()); }
function c777(): void { say("map/picked-and-returned/strict-eq", (get777()) === (get777())); }

function make778(): Map<string, () => number> { return new Map([["k", () => 1]]); }
let slot778: unknown;
function put778(): unknown { slot778 = make778().get("k"); return 0; }
function c778(): void { say("map/variable/strict-eq", ((put778(), slot778)) === ((put778(), slot778))); }

function make779(): Map<string, () => number> { return new Map([["k", () => 1]]); }
let kept779: Map<string, () => number> | undefined;
function keep779(): unknown { kept779 = make779(); return 0; }
function c779(): void { say("map/holder-in-a-variable/strict-eq", ((keep779(), kept779!.get("k"))) === ((keep779(), kept779!.get("k")))); }

function make780(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function with780<T>(k: (f: unknown) => T): T { return k(make780().get("k")); }
function c780(): void { say("map/callback/strict-eq", (with780(x => x)) === (with780(x => x))); }

function make781(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function later781(): () => unknown { const t = make781(); return () => t.get("k"); }
function c781(): void { say("map/closure/strict-eq", (later781()()) === (later781()())); }

function make782(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function later782(): () => unknown { const f = make782().get("k"); return () => f; }
function c782(): void { say("map/captured/strict-eq", (later782()()) === (later782()())); }

function make783(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function wrap783(): { f: unknown } { return { f: make783().get("k") }; }
function c783(): void { say("map/rewrapped/strict-eq", (wrap783().f) === (wrap783().f)); }

function make784(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function wrap784(): unknown[] { return [make784().get("k")]; }
function c784(): void { say("map/rewrapped-in-an-array/strict-eq", (wrap784()[0]) === (wrap784()[0])); }

function make785(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function* gen785(): Generator<unknown> { yield make785().get("k"); }
function c785(): void { say("map/generator/strict-eq", (gen785().next().value) === (gen785().next().value)); }

function make786(): Map<string, () => number> { return new Map([["k", () => 1]]); }
class K786 { get(): unknown { return make786().get("k"); } }
function c786(): void { say("map/method/strict-eq", (new K786().get()) === (new K786().get())); }

function make787(): Map<string, () => number> { return new Map([["k", () => 1]]); }
class K787 { get f(): unknown { return make787().get("k"); } }
function c787(): void { say("map/accessor/strict-eq", (new K787().f) === (new K787().f)); }

function make788(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function first788(...xs: unknown[]): unknown { return xs[0]; }
function c788(): void { say("map/rest/strict-eq", (first788(make788().get("k"))) === (first788(make788().get("k")))); }

function make789(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get789(): unknown { try { throw make789().get("k"); } catch (e) { return e; } }
function c789(): void { say("map/thrown/strict-eq", (get789()) === (get789())); }

function make790(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get790(other: unknown, which: boolean): unknown { return which ? make790().get("k") : other; }
function c790(): void { say("map/one-arm/strict-eq", (get790(0, true)) === (get790(0, true))); }

function make791(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get791(): unknown { let t = make791(); for (let i = 0; i < 2; i++) t = make791(); return t.get("k"); }
function c791(): void { say("map/loop/strict-eq", (get791()) === (get791())); }

function make792(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function id792<T>(x: T): T { return x; }
function get792(): unknown { return id792(make792()).get("k"); }
function c792(): void { say("map/identity/strict-eq", (get792()) === (get792())); }

function make793(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get793(): unknown { return make793().get("k"); }
const g793 = [get793];
function c793(): void { say("map/by-value/strict-eq", (g793[0]()) === (g793[0]())); }

function make805(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get805(): unknown { return make805().get("k"); }
function c805(): void { say("map/getter/strict-ne", (get805()) !== (get805())); }

function make806(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get806(): unknown { return make806().get("k"); }
function c806(): void { say("map/getter/loose-eq", (get806()) == (get806())); }

function make807(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get807(): unknown { return make807().get("k"); }
function c807(): void { say("map/getter/object-is", Object.is((get807()), (get807()))); }

function make808(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get808(): unknown { return make808().get("k"); }
function c808(): void { say("map/getter/set", new Set([(get808()), (get808())]).size); }

function make809(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get809(): unknown { return make809().get("k"); }
function c809(): void { say("map/getter/map-key", new Map([[(get809()), 1], [(get809()), 2]]).size); }

function make810(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get810(): unknown { return make810().get("k"); }
function c810(): void { say("map/getter/includes", [(get810())].includes((get810()))); }

function make811(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get811(): unknown { return make811().get("k"); }
function c811(): void { say("map/getter/index-of", [(get811())].indexOf((get811()))); }

function make812(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get812(): unknown { return make812().get("k"); }
const ws812 = new WeakSet<object>();
function c812(): void { say("map/getter/weak-set", (ws812.add((get812()) as object), ws812.has((get812()) as object))); }

function make813(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get813(): unknown { return make813().get("k"); }
const wm813 = new WeakMap<object, number>();
function c813(): void { say("map/getter/weak-map", (wm813.set((get813()) as object, 1), wm813.has((get813()) as object))); }

function make814(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get814(): unknown { return make814().get("k"); }
function c814(): void { say("map/getter/written", ((((get814())) as any).tag = 1, (((get814())) as any).tag)); }

function make815(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get815(): unknown { return make815().get("k"); }
function c815(): void { say("map/getter/defined", (Object.defineProperty((get815()) as object, "t", { value: 1 }), "t" in ((get815()) as object))); }

function make816(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get816(): unknown { return make816().get("k"); }
function c816(): void { say("map/getter/frozen", (Object.freeze((get816())), Object.isFrozen((get816())))); }

function make817(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get817(): unknown { return make817().get("k"); }
function c817(): void { say("map/getter/prototype-set", (Object.setPrototypeOf((get817()) as object, null), Object.getPrototypeOf((get817())) === null)); }

function make818(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get818(): unknown { return make818().get("k"); }
function c818(): void { say("map/getter/deleted", (delete (((get818())) as any).length, Object.hasOwn((get818()) as object, "length"))); }

function make819(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get819(): unknown { return make819().get("k"); }
function same819(a: unknown, b: unknown): boolean { return a === b; }
function c819(): void { say("map/getter/in-a-callee", same819((get819()), (get819()))); }

function make820(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get820(): unknown { return make820().get("k"); }
function hit820(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c820(): void { say("map/getter/switch", hit820((get820()), (get820()))); }

function make821(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get821(): unknown { return make821().get("k"); }
let last821: unknown;
function seen821(f: unknown): boolean { const same = f === last821; last821 = f; return same; }
function c821(): void { say("map/getter/kept-then-compared", (seen821((get821())), seen821((get821())))); }

interface R822 { a822: number; m822?: () => number }
function make822(): R822 { const r: R822 = { a822: 1 }; r.m822 = () => 1; return r; }
function c822(): void { say("stored-later/inline/strict-eq", (make822().m822) === (make822().m822)); }

interface R823 { a823: number; m823?: () => number }
function make823(): R823 { const r: R823 = { a823: 1 }; r.m823 = () => 1; return r; }
function get823(): unknown { return make823().m823; }
function c823(): void { say("stored-later/getter/strict-eq", (get823()) === (get823())); }

interface R824 { a824: number; m824?: () => number }
function make824(): R824 { const r: R824 = { a824: 1 }; r.m824 = () => 1; return r; }
function get824a(): unknown { return make824().m824; }
function get824b(): unknown { return get824a(); }
function get824(): unknown { return get824b(); }
function c824(): void { say("stored-later/forwarded/strict-eq", (get824()) === (get824())); }

interface R825 { a825: number; m825?: () => number }
function make825(): R825 { const r: R825 = { a825: 1 }; r.m825 = () => 1; return r; }
function pick825(x: R825): unknown { return x.m825; }
function c825(): void { say("stored-later/picked/strict-eq", (pick825(make825())) === (pick825(make825()))); }

interface R826 { a826: number; m826?: () => number }
function make826(): R826 { const r: R826 = { a826: 1 }; r.m826 = () => 1; return r; }
function pick826(x: R826): unknown { return x.m826; }
function get826(): unknown { return pick826(make826()); }
function c826(): void { say("stored-later/picked-and-returned/strict-eq", (get826()) === (get826())); }

interface R827 { a827: number; m827?: () => number }
function make827(): R827 { const r: R827 = { a827: 1 }; r.m827 = () => 1; return r; }
let slot827: unknown;
function put827(): unknown { slot827 = make827().m827; return 0; }
function c827(): void { say("stored-later/variable/strict-eq", ((put827(), slot827)) === ((put827(), slot827))); }

interface R828 { a828: number; m828?: () => number }
function make828(): R828 { const r: R828 = { a828: 1 }; r.m828 = () => 1; return r; }
let kept828: R828 | undefined;
function keep828(): unknown { kept828 = make828(); return 0; }
function c828(): void { say("stored-later/holder-in-a-variable/strict-eq", ((keep828(), kept828!.m828)) === ((keep828(), kept828!.m828))); }

interface R829 { a829: number; m829?: () => number }
function make829(): R829 { const r: R829 = { a829: 1 }; r.m829 = () => 1; return r; }
function with829<T>(k: (f: unknown) => T): T { return k(make829().m829); }
function c829(): void { say("stored-later/callback/strict-eq", (with829(x => x)) === (with829(x => x))); }

interface R830 { a830: number; m830?: () => number }
function make830(): R830 { const r: R830 = { a830: 1 }; r.m830 = () => 1; return r; }
function later830(): () => unknown { const t = make830(); return () => t.m830; }
function c830(): void { say("stored-later/closure/strict-eq", (later830()()) === (later830()())); }

interface R831 { a831: number; m831?: () => number }
function make831(): R831 { const r: R831 = { a831: 1 }; r.m831 = () => 1; return r; }
function later831(): () => unknown { const f = make831().m831; return () => f; }
function c831(): void { say("stored-later/captured/strict-eq", (later831()()) === (later831()())); }

interface R832 { a832: number; m832?: () => number }
function make832(): R832 { const r: R832 = { a832: 1 }; r.m832 = () => 1; return r; }
function wrap832(): { f: unknown } { return { f: make832().m832 }; }
function c832(): void { say("stored-later/rewrapped/strict-eq", (wrap832().f) === (wrap832().f)); }

interface R833 { a833: number; m833?: () => number }
function make833(): R833 { const r: R833 = { a833: 1 }; r.m833 = () => 1; return r; }
function wrap833(): unknown[] { return [make833().m833]; }
function c833(): void { say("stored-later/rewrapped-in-an-array/strict-eq", (wrap833()[0]) === (wrap833()[0])); }

interface R834 { a834: number; m834?: () => number }
function make834(): R834 { const r: R834 = { a834: 1 }; r.m834 = () => 1; return r; }
function* gen834(): Generator<unknown> { yield make834().m834; }
function c834(): void { say("stored-later/generator/strict-eq", (gen834().next().value) === (gen834().next().value)); }

interface R835 { a835: number; m835?: () => number }
function make835(): R835 { const r: R835 = { a835: 1 }; r.m835 = () => 1; return r; }
class K835 { get(): unknown { return make835().m835; } }
function c835(): void { say("stored-later/method/strict-eq", (new K835().get()) === (new K835().get())); }

c765(); c766(); c767(); c768(); c769(); c770(); c771(); c772(); c773(); c774(); c775(); c776(); c777(); c778(); c779(); c780(); c781(); c782(); c783(); c784(); c785(); c786(); c787(); c788(); c789(); c790(); c791(); c792(); c793(); c805(); c806(); c807(); c808(); c809(); c810(); c811(); c812(); c813(); c814(); c815(); c816(); c817(); c818(); c819(); c820(); c821(); c822(); c823(); c824(); c825(); c826(); c827(); c828(); c829(); c830(); c831(); c832(); c833(); c834(); c835();
console.log(out.join("\n"));
