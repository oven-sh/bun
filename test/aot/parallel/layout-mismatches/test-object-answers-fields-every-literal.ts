// Every literal of a shape lists the same names, so a reader of several of them tests the object once. Whoever takes one of those names away, or makes an object of the shape some other way,
// has to be seen by that one test: each way is tried below on an object of its own, and every object goes through the same readers.
const out: string[] = [];
const suffix = process.argv[2] ?? "";
const hide = new Function("value", "return value" + suffix) as <V>(value: V) => V;
const storeUnseen = new Function("object", "key", "value", "object[key] = value" + suffix) as (object: object, key: string, value: unknown) => void;
const defineUnseen = new Function("object", "key", "descriptor", "return Object.defineProperty(object, key, descriptor)" + suffix) as (object: object, key: string, descriptor: PropertyDescriptor) => void;
const removeUnseen = new Function("object", "key", "return delete object[key]" + suffix) as (object: object, key: string) => boolean;
const setPrototypeUnseen = new Function("object", "prototype", "return Object.setPrototypeOf(object, prototype)" + suffix) as (object: object, prototype: object | null) => void;

interface Hook { state: unknown; base: unknown; queue: Hook | null; label: string; next: Hook | null }
interface Pair { left: unknown; right: unknown; note?: string }

function make(seed: number): Hook { return hide({ state: seed, base: "b" + seed, queue: null, label: "hook " + seed, next: null }); }
function makeInOtherOrder(seed: number): Hook { return hide({ next: null, label: "other " + seed, queue: null, base: seed * 2, state: [seed] }); }
function makePair(seed: number): Pair { return hide({ left: seed, right: -seed }); }
function makePairWithNote(seed: number): Pair { return hide({ left: seed, right: -seed, note: "n" + seed }); }

function read(hook: Hook): unknown[] { return [hook.state, hook.base, hook.queue, hook.label, hook.next, Object.keys(hook).join()]; }
function copy(hook: Hook): Hook { return { state: hook.state, base: hook.base, queue: hook.queue, label: hook.label, next: null }; }
function change(hook: Hook): unknown[] { hook.state = "changed"; hook.base = 7; hook.next = hook; const same = hook.next === hook; hook.next = null; return [hook.state, hook.base, same, Object.keys(hook).join()]; }
function readAcrossACall(hook: Hook, between: (hook: Hook) => void): unknown[] { const before = hook.state; const label = hook.label; between(hook); return [before, hook.state, label, hook.label, hook.base]; }
function has(hook: Hook): unknown[] { return ["state" in hook, "base" in hook, Object.hasOwn(hook, "label"), hook.hasOwnProperty?.("next")]; }
function readPair(pair: Pair): unknown[] { return [pair.left, pair.right, pair.note, Object.keys(pair).join()]; }
function walk(head: Hook | null): string { let text = ""; for (let hook = head; hook !== null; hook = hook.next) text += hook.label + "=" + String(hook.state) + ";"; return text; }

// A literal that goes on with a getter, a computed key or a spread: each shape has readers of its own, so that the shapes above keep what they have.
interface Owner { host: unknown; readonly id: unknown; label: string }
interface Keyed { first: unknown; second: unknown; label: string }
interface Spread { first: unknown; second: unknown; label: string }
function makeOwner(seed: number): Owner { const held = { id: seed }; return hide({ host: "h" + seed, get id() { return held.id; }, label: "owner " + seed }); }
function makeKeyed(seed: number): Keyed { const key = hide("second"); return hide({ first: seed, [key]: -seed, label: "keyed " + seed } as unknown as Keyed); }
function makeSpread(seed: number): Spread { return hide({ first: seed, ...hide({ second: -seed, more: 1 }), label: "spread " + seed }); }
function readOwner(owner: Owner): unknown[] { return [owner.host, owner.id, owner.label, Object.keys(owner).join()]; }
function readKeyed(keyed: Keyed): unknown[] { return [keyed.first, keyed.second, keyed.label, Object.keys(keyed).join()]; }
function readSpread(spread: Spread): unknown[] { return [spread.first, spread.second, spread.label, Object.keys(spread).join()]; }

function show(name: string, value: unknown) {
    out.push(name + ": " + JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "symbol" ? String(v) : v)));
}
function attempt(name: string, run: () => unknown) { try { show(name, run()); } catch (error) { show(name, (error as Error).constructor.name); } }
function tryAll(name: string, hook: Hook) {
    attempt(name + ", read", () => read(hook)); attempt(name + ", has", () => has(hook)); attempt(name + ", copy", () => read(copy(hook)));
    attempt(name + ", walk", () => walk(hook)); attempt(name + ", change", () => change(hook)); attempt(name + ", read again", () => read(hook));
}

for (let round = 0; round < 3; round++) {
    tryAll("as made", make(1));
    tryAll("in another order", makeInOtherOrder(2));
    { const hook = make(3); delete (hook as Partial<Hook>).state; tryAll("deleted here", hook); }
    { const hook = make(4); removeUnseen(hook, "base"); tryAll("deleted by unseen code", hook); }
    { const hook = make(5); removeUnseen(hook, "label"); setPrototypeUnseen(hook, { label: "inherited" }); tryAll("deleted, then inherited", hook); }
    { const hook = make(6); removeUnseen(hook, "state"); storeUnseen(hook, "state", "back"); tryAll("deleted and stored again", hook); }
    { const hook = make(7); defineUnseen(hook, "state", { get() { return "from a getter"; }, set() {}, configurable: true, enumerable: true }); tryAll("an accessor", hook); }
    { const hook = make(8); defineUnseen(hook, "base", { value: "read only", writable: false, configurable: true, enumerable: false }); tryAll("read only and hidden", hook); }
    { const hook = make(9); Object.freeze(hook); tryAll("frozen", hook); }
    { const hook = make(10); Object.seal(hook); tryAll("sealed", hook); }
    { const hook = make(11); storeUnseen(hook, "label", 12); storeUnseen(hook, "queue", "no hook"); tryAll("other types", hook); }
    { const hook = make(12); storeUnseen(hook, "state", undefined); storeUnseen(hook, "next", undefined); tryAll("undefined stored", hook); }
    { const hook = make(13); storeUnseen(hook, "extra", 1); tryAll("one more name", hook); }
    tryAll("parsed", hide(JSON.parse('{"state":1,"base":2,"queue":null,"label":"parsed","next":null}')) as Hook);
    tryAll("parsed, a name short", hide(JSON.parse('{"state":1,"queue":null,"label":"short","next":null}')) as Hook);
    tryAll("spread", hide({ ...make(14) }));
    tryAll("spread with a change", hide({ ...make(15), label: "spread" }));
    tryAll("assigned", hide(Object.assign({}, make(16))) as Hook);
    tryAll("assigned onto one", Object.assign(make(17), hide({ state: "assigned", label: "onto" })));
    tryAll("created with a prototype", hide(Object.create(make(18))) as Hook);
    tryAll("cloned", hide(structuredClone({ state: 1, base: 2, queue: null, label: "cloned", next: null })) as Hook);
    tryAll("from entries", hide(Object.fromEntries(Object.entries(make(19)))) as unknown as Hook);
    tryAll("empty", hide({}) as Hook);
    tryAll("a proxy", hide(new Proxy(make(20), { get: (target, key) => (key === "state" ? "trapped" : Reflect.get(target, key)) })));
    attempt("deleted between two reads", () => readAcrossACall(make(21), hook => { removeUnseen(hook, "state"); removeUnseen(hook, "label"); }));
    attempt("redefined between two reads", () => readAcrossACall(make(22), hook => defineUnseen(hook, "label", { get: () => "late", configurable: true })));
    attempt("nothing between two reads", () => readAcrossACall(make(23), () => {}));
    { const a = make(24), b = makeInOtherOrder(25), c = make(26); a.next = b; b.next = c; removeUnseen(b, "state"); attempt("a chain with a gap", () => walk(a)); }
    attempt("pair", () => readPair(makePair(1))); attempt("pair with note", () => readPair(makePairWithNote(2)));
    { const pair = makePairWithNote(3); removeUnseen(pair, "note"); attempt("pair, note deleted", () => readPair(pair)); }
    { const pair = makePair(4); removeUnseen(pair, "left"); attempt("pair, left deleted", () => readPair(pair)); }
    { const pair = makePair(5); storeUnseen(pair, "note", "late"); attempt("pair, note added", () => readPair(pair)); }
    attempt("a getter in the literal", () => readOwner(makeOwner(1)));
    { const owner = makeOwner(2); removeUnseen(owner, "host"); attempt("a getter in the literal, a field deleted", () => readOwner(owner)); }
    { const owner = makeOwner(3); owner.label = "stored"; storeUnseen(owner, "host", 7); attempt("a getter in the literal, fields stored", () => readOwner(owner)); }
    attempt("a computed key in the literal", () => readKeyed(makeKeyed(4)));
    { const keyed = makeKeyed(5); removeUnseen(keyed, "first"); attempt("a computed key in the literal, a field deleted", () => readKeyed(keyed)); }
    attempt("a spread in the literal", () => readSpread(makeSpread(6)));
    { const spread = makeSpread(7); removeUnseen(spread, "label"); storeUnseen(spread, "label", "again"); attempt("a spread in the literal, a field deleted and stored again", () => readSpread(spread)); }
}
console.log(out.join("\n"));
