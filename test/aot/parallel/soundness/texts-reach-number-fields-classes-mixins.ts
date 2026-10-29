// Classes that mixins made inherit a field declared as a number, and a text reaches the field in untyped ways. A validating build aborts where a proof is false.
// Flags: --aot-validate
const names: string[] = JSON.parse('["x", "y"]');
const parsed: any = JSON.parse('{"x": "text"}');
function pick<T>(c: T): T { return c; }
function show(o: object): string { const a = o as any; return typeof a.x + ":" + String(a.x) + " " + Object.keys(o).join("+") + " " + JSON.stringify(o); }
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  function act(o: { x: number | string }): void { o.x = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin, wider type", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  function act(o: any): void { o.x = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin, any", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  function act(o: any): void { o[names[0]] = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin, computed key", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const Again = <B extends new (...a: any[]) => P>(b: B) => class extends b { v: number = 5; };
  const C = Again(Mix(P));
  function act(o: { x: number | string }): void { o.x = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin over mixin, wider type", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const Again = <B extends new (...a: any[]) => P>(b: B) => class extends b { v: number = 5; };
  const C = Again(Mix(P));
  function act(o: any): void { for (const k of Object.keys(parsed)) o[k] = parsed[k]; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin over mixin, copied data", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Picked = pick(P);
  class C extends Picked { u: number = 6; }
  function act(o: any): void { o.x = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base handed through a function, any", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
