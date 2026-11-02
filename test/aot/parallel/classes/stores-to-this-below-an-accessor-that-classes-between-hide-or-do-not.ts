// A store to `this` under a name that a class above declares as an accessor runs the accessor, unless a class between says something else of the name.
const log: unknown[] = [];
class Top { kept = 0; set size(v: number) { this.kept = v + 1; } get size() { return this.kept; } get only() { return 7; } set wide(v: number) { this.kept = v * 2; } static set fixed(v: number) { log.push("static " + v); } }
class Plain extends Top { constructor() { super(); (this as any).size = 1; (this as any).wide = 2; (this as any).fixed = 3; (this as any).other = 4; } }
class Between extends Top {}
class Far extends Between { constructor() { super(); (this as any).size = 5; } }
class HidesByMethod extends Top { size2() {} }
class MethodOfName extends (Top as any) { size() { return 1; } }
class BelowMethod extends MethodOfName { constructor() { super(); try { (this as any).size = 6; } catch (e) { log.push("threw"); } } }
class FieldOfName extends (Top as any) { size = 9; }
class BelowField extends FieldOfName { constructor() { super(); (this as any).size = 10; } }
class DeclaredOnly extends (Top as any) { declare size: number; }
class BelowDeclared extends DeclaredOnly { constructor() { super(); (this as any).size = 11; } }
class StoresToo extends Top { constructor() { super(); (this as any).size = 12; } }
class BelowStore extends StoresToo { constructor() { super(); (this as any).size = 13; } }
class InPrototype extends Top {}
(InPrototype.prototype as any).size = 14;
class BelowPrototype extends InPrototype { constructor() { super(); (this as any).size = 15; } }
const key = "com" + "puted";
class Computed extends Top { [key]() {} }
class BelowComputed extends Computed { constructor() { super(); (this as any).size = 16; } }
class AccessorAgain extends (MethodOfName as any) { set size(v: number) { (this as any).kept = -v; } }
class BelowAgain extends AccessorAgain { constructor() { super(); (this as any).size = 17; } }
class OwnAccessor extends Top { set size(v: number) { this.kept = v + 100; } constructor() { super(); this.size = 18; } }
class OwnMethodThenStore extends (Top as any) { size() {} constructor() { super(); (this as any).size = 19; } }
const mark = Symbol("mark");
class WithSymbol { set [mark](v: number) { log.push("symbol " + v); } }
class BelowSymbol extends WithSymbol { constructor() { super(); (this as any)[mark] = 20; } }
class WithPrivate { #size = 1; set size(v: number) { this.#size = v; } get size() { return this.#size; } }
class BelowPrivate extends WithPrivate { #size = 2; constructor() { super(); this.size = 21; log.push(this.#size); } }
function Old(this: any) { this.size = 22; }
Object.defineProperty(Old.prototype, "size", { set(v) { this.kept = v; }, get() { return this.kept; }, configurable: true });
function Older(this: any) {}
Older.prototype = { set size(v: number) { (this as any).kept = v + 3; }, get size() { return (this as any).kept; } };
function Newer(this: any) { this.size = 23; }
Newer.prototype = Object.create(Older.prototype);
class OverFunction extends (Older as any) { constructor() { super(); (this as any).size = 24; } }
class OverLibrary extends Map<string, number> { constructor() { super(); try { (this as any).size = 25; } catch (e) { log.push("library threw"); } } }
for (const make of [Plain, Far, BelowMethod, BelowField, BelowDeclared, StoresToo, BelowStore, BelowPrototype, BelowComputed, BelowAgain, OwnAccessor, OwnMethodThenStore, BelowSymbol, BelowPrivate, Old, Newer, OverFunction, OverLibrary, HidesByMethod] as any[]) {
  const it = new make();
  log.push(make.name + " " + Object.keys(it).join() + " " + String(typeof it.size === "function" ? "function" : it.size) + " " + it.kept);
}
console.log(log.join("\n"));
