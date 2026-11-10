// `inst.core.run(x)` outside loops, `run` a function kept in a field: the typed way reads it out of its slot, the closed arm by name. Every way in which the guess or one of its looks fails must say what plain says:
// another shape with the same names, `core` replaced, `run` deleted, `run` replaced by a getter above, `core` missing (the error and its text), a receiver that counts its reads, and the order of the read and the argument.
class Core {
  run: (x: number) => number;
  depth: number;
  constructor(k: number) {
    this.depth = k;
    this.run = k & 1 ? x => x + k : x => x * k;
  }
}
class Schema {
  core: Core;
  name: string;
  constructor(k: number) {
    this.core = new Core(k);
    this.name = "s" + k;
  }
}
const said: string[] = [];
function apply(inst: Schema, x: number): number {
  return inst.core.run(x);
}
function applyWithArgumentThatWrites(inst: Schema, x: number): number {
  return inst.core.run(((inst.core.run = y => y - 1000), x));
}
function tell(what: string, make: () => unknown): void {
  try {
    said.push(what + ": " + String(make()));
  } catch (error) {
    said.push(what + ": " + (error as Error).constructor.name + ": " + (error as Error).message);
  }
}
const names: string[] = JSON.parse('["apply", "applyWithArgumentThatWrites"]');
const table: Record<string, (inst: Schema, x: number) => number> = { apply, applyWithArgumentThatWrites };
const call = (which: number, inst: unknown, x: number) => table[names[which]!]!(inst as Schema, x);
tell("as made, odd", () => call(0, new Schema(3), 4));
tell("as made, even", () => call(0, new Schema(4), 4));
tell("another shape", () => call(0, { name: "n", core: { run: (x: number) => x - 1, depth: 0 } }, 4));
tell("core of another shape", () => { const s = new Schema(3); (s as any).core = { run: (x: number) => x - 2 }; return call(0, s, 4); });
tell("run deleted", () => { const s = new Schema(3); delete (s.core as any).run; return call(0, s, 4); });
tell("run deleted, one above", () => { const s = new Schema(3); delete (s.core as any).run; (Core.prototype as any).run = function (this: Core, x: number) { return x + this.depth * 100; }; const told = call(0, s, 4); delete (Core.prototype as any).run; return told; });
tell("run is no function", () => { const s = new Schema(3); (s.core as any).run = 7; return call(0, s, 4); });
tell("core missing", () => { const s = new Schema(3); delete (s as any).core; return call(0, s, 4); });
tell("core null", () => { const s = new Schema(3); (s as any).core = null; return call(0, s, 4); });
tell("nothing handed", () => call(0, undefined, 4));
tell("this of the call", () => { const s = new Schema(3); (s.core as any).run = function (this: Core, x: number) { return this === s.core ? x : -1; }; return call(0, s, 4); });
tell("reads counted", () => { const reads: string[] = []; const s = new Proxy(new Schema(3), { get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver); } }); return call(0, s, 4) + " " + reads.join(); });
tell("the method is read in front of the argument", () => call(1, new Schema(3), 4));
tell("frozen", () => call(0, Object.freeze(new Schema(5)), 4));
tell("a class below", () => { class Below extends Schema { more = 1; } return call(0, new Below(5), 4); });
console.log(said.join("\n"));
