// Class members looked up by name through `any`: methods, accessors, `constructor`, inherited members, missing names and names the engine looks up itself, once and repeatedly, before and after the prototype's keys are enumerated.
const lines: string[] = [];
class Base { kind = "base"; shared(): string { return "shared by " + this.kind; } get label(): string { return "label of " + this.kind; } }
class Middle extends Base { middle(): number { return 2; } }
class Leaf extends Middle { kind = "leaf"; leaf(): number { return 3; } static made(): Leaf { return new Leaf(); } }
class Alone { value = 1; only(): number { return this.value; } }
class Emitter { handlers: Record<string, Array<(v: unknown) => void>> = {}; on(name: string, f: (v: unknown) => void): this { (this.handlers[name] ??= []).push(f); return this; } emit(name: string, v: unknown): boolean { for (const f of this.handlers[name] ?? []) f(v); return name in this.handlers; } }
class Service extends Emitter { started = false; start(): void { this.started = true; this.emit("start", 1); } }
const any = (v: unknown): any => v;
const leaf = any(new Leaf()), alone = any(new Alone()), service = any(new Service());
lines.push([leaf.missing, alone.missing, leaf.toJSON, alone.then, leaf.constructor === Leaf, alone.constructor.name, typeof leaf.hasOwnProperty, typeof alone.toString].join());
lines.push([leaf.shared(), leaf.label, leaf.middle(), leaf.leaf(), alone.only()].join());
lines.push(["missing" in leaf, "shared" in leaf, "leaf" in leaf, "only" in alone, "toString" in alone, Object.hasOwn(leaf, "leaf"), Object.hasOwn(Leaf.prototype, "leaf"), Object.hasOwn(Leaf.prototype, "shared"), Object.hasOwn(Middle.prototype, "nothing")].join());
const seen: unknown[] = []; service.on("start", (v: unknown) => seen.push(v)); service.start(); lines.push(seen.join() + " " + service.started + " " + service.emit("none", 0));
class Quiet { a = 1; hidden(): number { return 1; } }
const quiet = any(new Quiet());
lines.push(JSON.stringify(quiet) + " " + String(quiet) + " " + `${Object.keys(quiet)}` + " " + Object.prototype.toString.call(quiet) + " " + (quiet + "") + " " + JSON.stringify({ ...quiet }));
lines.push(Object.getOwnPropertyNames(Quiet.prototype).join() + " " + Object.keys(Quiet.prototype).length + " " + JSON.stringify(Object.getOwnPropertyDescriptor(Quiet.prototype, "nothing")) + " " + typeof Object.getOwnPropertyDescriptor(Quiet.prototype, "hidden")?.value);
class Later { b = 2; own(): number { return 2; } }
const later = any(new Later());
lines.push(String(later.added) + " " + String(later.added));
class Often { c = 3; real(): number { return 3; } }
let count = 0; const often = any(new Often()); for (let i = 0; i < 5000; i++) { if (often.nothing === undefined) count++; if (often["n" + (i % 7)] === undefined) count++; } lines.push(count + " " + often.real());
class Chain1 { m1(): number { return 1; } } class Chain2 extends Chain1 { m2(): number { return 2; } } class Chain3 extends Chain2 { m3(): number { return 3; } } class Chain4 extends Chain3 { m4(): number { return 4; } }
const chain = any(new Chain4()); lines.push([chain.m1(), chain.nothing, chain.m3(), chain.m2(), chain.m4(), Object.getPrototypeOf(Object.getPrototypeOf(chain)) === Chain3.prototype].join());
class Awaited { d = 4; work(): number { return 4; } }
async function wait(): Promise<void> { const got = await any(new Awaited()); lines.push("awaited " + got.d + " " + got.work()); const all = await Promise.all([new Awaited(), Promise.resolve(new Awaited())]); lines.push("all " + all.length); }
class Iterated { e = 5; step(): number { return 5; } }
try { for (const x of any(new Iterated())) lines.push(String(x)); } catch (e) { lines.push((e as Error).constructor.name); }
lines.push(String(any(new Iterated())[Symbol.iterator]) + " " + String(any(new Iterated())[Symbol.toPrimitive]) + " " + (any(new Iterated()) instanceof Iterated) + " " + (any(new Leaf()) instanceof Base));
class Listed { f = 6; one(): void {} two(): void {} } const names: string[] = []; for (const k in any(new Listed())) names.push(k); lines.push(names.join() + " " + Reflect.ownKeys(Listed.prototype).join());
class Same { g = 7; first(): string { return "first"; } second(): string { return "second " + this.g; } get third(): string { return "third"; } static fourth(): string { return "fourth"; } }
const same = any(new Same()), early = same.first, earlySecond = same.second, earlyConstructor = same.constructor;
lines.push([early(), earlySecond.call(same), early.name, early.length, typeof early.prototype, earlyConstructor === Same, earlyConstructor.fourth()].join());
lines.push([Object.getOwnPropertyNames(Same.prototype).join("+"), same.first === early, any(Same.prototype).first === early, any(new Same()).second === earlySecond, same.third, same.constructor === earlyConstructor].join());
class Busy { h = 8; a(): number { return 1; } b(): number { return 2; } c(): number { return 3; } }
let busy = 0; const worker = any(new Busy()); const before = worker.a; for (let i = 0; i < 4000; i++) busy += worker.a() + worker["b"]() + any(new Busy()).c(); lines.push(busy + " " + (worker.a === before));
class Up { top(): string { return "top"; } both(): string { return "both of Up"; } } class Down extends Up { both(): string { return "both of Down, " + super.both(); } low(): string { return "low"; } }
const down = any(new Down()); lines.push([down.top(), down.both(), down.low(), down.top === any(new Up()).top, down.both !== any(new Up()).both, "top" in down, "low" in any(new Up())].join());
class Twice { m(): number { return 1; } } const t1 = any(new Twice()), t2 = any(new Twice()); lines.push(String(t1.m === t2.m) + " " + Reflect.get(t1, "m").call(t2) + " " + Reflect.has(t1, "m") + " " + (Object.getPrototypeOf(t1).m === t1.m));
function plainClasses(): string { class Local { v = 1; run(): number { return this.v; } } return String(any(new Local()).run()) + any(new Local()).constructor.name; } lines.push(plainClasses() + plainClasses());
class Vault { #secret(): string { return "secret"; } get #hidden(): string { return "hidden"; } static #sealed(): string { return "sealed"; } open(): string { return this.#secret() + this.#hidden + Vault.#sealed(); } }
const vault = any(new Vault()); let leaked = 0;
for (const name of ["secret", "hidden", "sealed"]) for (let file = 0; file < 4; file++) for (let index = 0; index < 64; index++) for (const key of ["\u00fe#" + name + "@" + file + "." + index, "#" + name + "@" + file + "." + index, "#" + name]) if (vault[key] !== undefined || key in vault) leaked++;
lines.push("private names reached by a spelled key: " + leaked + " " + vault.open() + " " + Object.getOwnPropertyNames(Object.getPrototypeOf(vault)).join());
wait().then(() => console.log(lines.join("\n")));
