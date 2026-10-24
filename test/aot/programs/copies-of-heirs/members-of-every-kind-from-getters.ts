// A copy of an instance lacks what the class provides by getters, whatever the member's type.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface Inner { x: number }
interface S { own: number; n: number; s: string; f: boolean; o: Inner; list: number[]; big: bigint; either: "a" | "b" }
class C implements S {
  own = 1;
  get n(): number { return 2 }
  get s(): string { return "s" }
  get f(): boolean { return true }
  get o(): Inner { return { x: 1 } }
  get list(): number[] { return [1] }
  get big(): bigint { return 1n }
  get either(): "a" | "b" { return "a" }
}
const copy = (s: S): S => ({ ...s });
const made = (): S => copy(new C());
row("own", () => made().own);
row("number", () => typeof made().n);
row("string", () => typeof made().s);
row("string joined", () => "<" + made().s + ">");
row("boolean", () => typeof made().f);
row("boolean tested", () => (made().f ? "yes" : "no"));
row("boolean compared", () => made().f === false);
row("object", () => typeof made().o);
row("read of the object", () => made().o.x);
row("optional read of the object", () => (made().o as Inner | undefined)?.x);
row("array", () => typeof made().list);
row("bigint", () => typeof made().big);
row("literal", () => { switch (made().either) { case "a": return "a"; case "b": return "b"; default: return "neither" } });
row("number compared", () => made().n > 1);
row("number in a template", () => `${made().n}`);
