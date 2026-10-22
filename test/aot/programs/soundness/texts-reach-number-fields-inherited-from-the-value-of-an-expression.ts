// Classes whose base is the value of an expression, as the class of a mixin, inherit a field declared as a number. A text reaches the field in every untyped way. Untyped reads get the text back, a typed store puts a number back, and another instance keeps its number.
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
  const C = Mix(P);
  function act(o: any): void { for (const k of Object.keys(parsed)) o[k] = parsed[k]; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin, copied data", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  function act(o: any): void { Object.assign(o, parsed); }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin, Object.assign", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const C = Mix(P);
  function act(o: any): void { Reflect.set(o, names[0], "text"); }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin, Reflect.set", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
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
  function act(o: any): void { o.x = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin over mixin, any", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const Again = <B extends new (...a: any[]) => P>(b: B) => class extends b { v: number = 5; };
  const C = Again(Mix(P));
  function act(o: any): void { o[names[0]] = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin over mixin, computed key", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
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
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const Again = <B extends new (...a: any[]) => P>(b: B) => class extends b { v: number = 5; };
  const C = Again(Mix(P));
  function act(o: any): void { Object.assign(o, parsed); }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin over mixin, Object.assign", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
  const Again = <B extends new (...a: any[]) => P>(b: B) => class extends b { v: number = 5; };
  const C = Again(Mix(P));
  function act(o: any): void { Reflect.set(o, names[0], "text"); }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("mixin over mixin, Reflect.set", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Picked = pick(P);
  class C extends Picked { u: number = 6; }
  function act(o: { x: number | string }): void { o.x = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base handed through a function, wider type", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
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
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Picked = pick(P);
  class C extends Picked { u: number = 6; }
  function act(o: any): void { o[names[0]] = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base handed through a function, computed key", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Picked = pick(P);
  class C extends Picked { u: number = 6; }
  function act(o: any): void { for (const k of Object.keys(parsed)) o[k] = parsed[k]; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base handed through a function, copied data", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Picked = pick(P);
  class C extends Picked { u: number = 6; }
  function act(o: any): void { Object.assign(o, parsed); }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base handed through a function, Object.assign", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  const Picked = pick(P);
  class C extends Picked { u: number = 6; }
  function act(o: any): void { Reflect.set(o, names[0], "text"); }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base handed through a function, Reflect.set", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  class C extends (names.length > 1 ? P : P) { t: number = 7; }
  function act(o: { x: number | string }): void { o.x = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base chosen by a condition, wider type", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  class C extends (names.length > 1 ? P : P) { t: number = 7; }
  function act(o: any): void { o.x = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base chosen by a condition, any", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  class C extends (names.length > 1 ? P : P) { t: number = 7; }
  function act(o: any): void { o[names[0]] = "text"; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base chosen by a condition, computed key", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  class C extends (names.length > 1 ? P : P) { t: number = 7; }
  function act(o: any): void { for (const k of Object.keys(parsed)) o[k] = parsed[k]; }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base chosen by a condition, copied data", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  class C extends (names.length > 1 ? P : P) { t: number = 7; }
  function act(o: any): void { Object.assign(o, parsed); }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base chosen by a condition, Object.assign", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
{
  class P { x: number = 1; sum(): number { return this.x + 1; } }
  class C extends (names.length > 1 ? P : P) { t: number = 7; }
  function act(o: any): void { Reflect.set(o, names[0], "text"); }
  const other: P = new C();
  const o: P = new C();
  const before = o.sum();
  act(o);
  const stored = show(o);
  o.x = 2;
  console.log("base chosen by a condition, Reflect.set", before, stored, "|", o.sum(), show(o), "|", other.sum(), show(other));
}
