// Private fields, methods and accessors of classes below built-in classes, asked for on their own objects, on objects of the classes beside and below them, and on look-alikes.
class Vault extends Map<string, number> {
  #limit: number;
  #used = 0;
  open = true;
  constructor(limit: number, entries?: [string, number][]) { super(entries); this.#limit = limit; }
  #room(): number { return this.#limit - this.#used; }
  get #full(): boolean { return this.#room() <= 0; }
  put(key: string, value: number): boolean { if (this.#full) return false; this.#used++; this.set(key, value); return true; }
  static is(value: unknown): boolean { return typeof value === "object" && value !== null && #limit in value; }
  static has(value: object): string { return String(#room in value) + String(#full in value) + String(#used in value); }
  static roomOf(value: Vault): number { return value.#room(); }
}
class Deep extends Vault { #own = 5; own(): number { return this.#own; } static is(value: object): boolean { return #own in value; } }
class Fault extends Error { #code: number; constructor(message: string, code: number) { super(message); this.#code = code; } code(): number { return this.#code; } static is(value: object): boolean { return #code in value; } }
class Stamp extends (function (this: any, o: any) { return o; } as any) { #stamp = 1; static is(value: object): boolean { return #stamp in value; } static read(value: any): number { return value.#stamp; } }
function fill(v: Vault): string { return String(v.put("a", 1)) + v.put("b", 2) + v.put("c", 3) + v.size + v.open; }
function attempt(label: string, run: () => unknown) { try { console.log(label, String(run())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name); } }
(globalThis as any).keep = [];
for (let round = 0; round < 4; round++) {
  const things: [string, any][] = [["vault", new Vault(2)], ["vault from entries", new Vault(2, [["x", 0]])], ["deep", new Deep(1)], ["fault", new Fault("f", 7)], ["map", new Map()],
    ["map with the prototype", Object.setPrototypeOf(new Map(), Vault.prototype)], ["made for Vault by Map", Reflect.construct(Map, [], Vault)], ["made by Vault for Deep", Reflect.construct(Vault, [3], Deep)], ["plain", {}]];
  for (const [label, thing] of things) {
    (globalThis as any).keep.push(thing); (globalThis as any).keep.length = 0;
    attempt(label + " is", () => [Vault.is(thing), Vault.has(thing), Deep.is(thing), Fault.is(thing), Stamp.is(thing)].join());
    attempt(label + " fill", () => fill(thing)); attempt(label + " room", () => Vault.roomOf(thing)); attempt(label + " own", () => thing.own()); attempt(label + " code", () => thing.code());
    attempt(label + " stamped", () => { new (Stamp as any)(thing); return [Stamp.is(thing), Stamp.read(thing), Vault.is(thing), Vault.has(thing)].join(); });
    attempt(label + " fill again", () => fill(thing)); attempt(label + " stamped twice", () => new (Stamp as any)(thing));
  }
}
