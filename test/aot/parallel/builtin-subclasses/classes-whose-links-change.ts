// The class object gets another parent, the prototype object another link or other members; then objects are made and used by typed code.
class Base extends Map<string, number> { tag(): string { return "base"; } get(key: string): number | undefined { return (super.get(key) ?? 0) + 1; } }
class Below extends Base { tag(): string { return "below " + super.tag(); } }
function tagOf(b: Base): string { return b.tag(); }
function read(b: Base, key: string): unknown { return b.get(key); }
function line(label: string, make: () => Base) {
  try { const b = make(); b.set?.("a", 1); console.log(label, tagOf(b), read(b, "a"), read(b, "z"), b instanceof Map, b instanceof Set, Object.prototype.toString.call(b)); }
  catch (e) { console.log(label, "threw", (e as Error).constructor.name, (e as Error).message); }
}
for (let i = 0; i < 3; i++) { line("as written", () => new Base()); line("as written below", () => new Below()); }
(Base.prototype as any).tag = function () { return "replaced"; };
for (let i = 0; i < 3; i++) { line("member replaced", () => new Base()); line("member replaced below", () => new Below()); }
const kept = new Base(), keptBelow = new Below();
Object.setPrototypeOf(Base.prototype, { has() { return "no map"; }, set() { return "no set"; }, get() { return 40; } });
for (let i = 0; i < 3; i++) { line("prototype link changed", () => new Base()); line("prototype link changed below", () => new Below()); line("kept", () => kept); line("kept below", () => keptBelow); }
Object.setPrototypeOf(Base.prototype, Map.prototype);
Object.setPrototypeOf(Base, Set);
for (let i = 0; i < 3; i++) { line("parent is Set", () => new Base()); line("parent is Set below", () => new Below()); line("kept", () => kept); }
Object.setPrototypeOf(Base, class { constructor() { return new Map([["a", 5]]); } });
for (let i = 0; i < 3; i++) { line("parent returns a Map", () => new Base()); line("parent returns a Map below", () => new Below()); }
Object.setPrototypeOf(Base, function () { return kept; });
for (let i = 0; i < 3; i++) { line("parent returns a kept object", () => new Base()); line("parent returns a kept object below", () => new Below()); }
Object.setPrototypeOf(Base, Map);
for (let i = 0; i < 3; i++) { line("parent is Map again", () => new Base()); line("parent is Map again below", () => new Below()); }
