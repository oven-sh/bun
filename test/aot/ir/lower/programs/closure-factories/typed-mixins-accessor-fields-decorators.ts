// RUN: lower
// OPTIONS: builtin-modules

// TypeScript's mixin pattern: the class expression has accessor fields, typed private members and static blocks. Decorators of a class expression that a function returns run once for each call.
type Ctor<T = {}> = new (...args: any[]) => T;
function show(label: string, f: () => unknown) { let shown; try { shown = JSON.stringify(f()); } catch (error: any) { shown = error.constructor.name; } console.log(label + ": " + shown); }
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { accessor v = 1; bump() { return ++this.v; } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, accessor field, extended", () => [new C().v, new C().bump()]);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { accessor v = 1; bump() { return ++this.v; } }; }
  const C = Mix(Object);
  show("generic function, accessor field, called", () => [new C().v, new C().bump()]);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { accessor v = 1; bump() { return ++this.v; } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, accessor field, called twice", () => [new C().v, new C().bump()]);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { accessor v = 1; bump() { return ++this.v; } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, accessor field, extended", () => [new C().v, new C().bump()]);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { accessor v = 1; bump() { return ++this.v; } };
  const C = Mix(Object);
  show("generic arrow, accessor field, called", () => [new C().v, new C().bump()]);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { accessor v = 1; bump() { return ++this.v; } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, accessor field, called twice", () => [new C().v, new C().bump()]);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static accessor v = 1; static { this.v = 5; } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, static accessor field, extended", () => C.v);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static accessor v = 1; static { this.v = 5; } }; }
  const C = Mix(Object);
  show("generic function, static accessor field, called", () => C.v);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static accessor v = 1; static { this.v = 5; } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, static accessor field, called twice", () => C.v);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static accessor v = 1; static { this.v = 5; } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, static accessor field, extended", () => C.v);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static accessor v = 1; static { this.v = 5; } };
  const C = Mix(Object);
  show("generic arrow, static accessor field, called", () => C.v);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static accessor v = 1; static { this.v = 5; } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, static accessor field, called twice", () => C.v);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { accessor #v = 1; bump() { return ++this.#v; } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, private accessor field, extended", () => new C().bump());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { accessor #v = 1; bump() { return ++this.#v; } }; }
  const C = Mix(Object);
  show("generic function, private accessor field, called", () => new C().bump());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { accessor #v = 1; bump() { return ++this.#v; } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, private accessor field, called twice", () => new C().bump());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { accessor #v = 1; bump() { return ++this.#v; } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, private accessor field, extended", () => new C().bump());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { accessor #v = 1; bump() { return ++this.#v; } };
  const C = Mix(Object);
  show("generic arrow, private accessor field, called", () => new C().bump());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { accessor #v = 1; bump() { return ++this.#v; } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, private accessor field, called twice", () => new C().bump());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static accessor #v = 1; static { this.#v = 6; (this as any).t = this.#v; } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, private static accessor field, extended", () => (C as any).t);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static accessor #v = 1; static { this.#v = 6; (this as any).t = this.#v; } }; }
  const C = Mix(Object);
  show("generic function, private static accessor field, called", () => (C as any).t);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static accessor #v = 1; static { this.#v = 6; (this as any).t = this.#v; } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, private static accessor field, called twice", () => (C as any).t);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static accessor #v = 1; static { this.#v = 6; (this as any).t = this.#v; } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, private static accessor field, extended", () => (C as any).t);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static accessor #v = 1; static { this.#v = 6; (this as any).t = this.#v; } };
  const C = Mix(Object);
  show("generic arrow, private static accessor field, called", () => (C as any).t);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static accessor #v = 1; static { this.#v = 6; (this as any).t = this.#v; } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, private static accessor field, called twice", () => (C as any).t);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { private v = 2; read() { return this.v; } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, private by type, extended", () => new C().read());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { private v = 2; read() { return this.v; } }; }
  const C = Mix(Object);
  show("generic function, private by type, called", () => new C().read());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { private v = 2; read() { return this.v; } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, private by type, called twice", () => new C().read());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { private v = 2; read() { return this.v; } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, private by type, extended", () => new C().read());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { private v = 2; read() { return this.v; } };
  const C = Mix(Object);
  show("generic arrow, private by type, called", () => new C().read());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { private v = 2; read() { return this.v; } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, private by type, called twice", () => new C().read());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static #c: number = 1; static t: number; static { this.t = this.#c; } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, typed private static field, extended", () => C.t);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static #c: number = 1; static t: number; static { this.t = this.#c; } }; }
  const C = Mix(Object);
  show("generic function, typed private static field, called", () => C.t);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static #c: number = 1; static t: number; static { this.t = this.#c; } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, typed private static field, called twice", () => C.t);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static #c: number = 1; static t: number; static { this.t = this.#c; } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, typed private static field, extended", () => C.t);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static #c: number = 1; static t: number; static { this.t = this.#c; } };
  const C = Mix(Object);
  show("generic arrow, typed private static field, called", () => C.t);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static #c: number = 1; static t: number; static { this.t = this.#c; } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, typed private static field, called twice", () => C.t);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static readonly a = 1; static readonly b = this.a + 1; static { (this as any).c = this.b + 1; } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, readonly static fields, extended", () => [C.a, C.b, (C as any).c]);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static readonly a = 1; static readonly b = this.a + 1; static { (this as any).c = this.b + 1; } }; }
  const C = Mix(Object);
  show("generic function, readonly static fields, called", () => [C.a, C.b, (C as any).c]);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { static readonly a = 1; static readonly b = this.a + 1; static { (this as any).c = this.b + 1; } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, readonly static fields, called twice", () => [C.a, C.b, (C as any).c]);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static readonly a = 1; static readonly b = this.a + 1; static { (this as any).c = this.b + 1; } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, readonly static fields, extended", () => [C.a, C.b, (C as any).c]);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static readonly a = 1; static readonly b = this.a + 1; static { (this as any).c = this.b + 1; } };
  const C = Mix(Object);
  show("generic arrow, readonly static fields, called", () => [C.a, C.b, (C as any).c]);
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { static readonly a = 1; static readonly b = this.a + 1; static { (this as any).c = this.b + 1; } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, readonly static fields, called twice", () => [C.a, C.b, (C as any).c]);
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { #m(x: number): number { return x * 2; } run() { return this.#m(4); } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, typed private method, extended", () => new C().run());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { #m(x: number): number { return x * 2; } run() { return this.#m(4); } }; }
  const C = Mix(Object);
  show("generic function, typed private method, called", () => new C().run());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { #m(x: number): number { return x * 2; } run() { return this.#m(4); } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, typed private method, called twice", () => new C().run());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { #m(x: number): number { return x * 2; } run() { return this.#m(4); } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, typed private method, extended", () => new C().run());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { #m(x: number): number { return x * 2; } run() { return this.#m(4); } };
  const C = Mix(Object);
  show("generic arrow, typed private method, called", () => new C().run());
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { #m(x: number): number { return x * 2; } run() { return this.#m(4); } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, typed private method, called twice", () => new C().run());
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { v?: number; static { (this as any).made = new this().v; } }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, optional field, extended", () => String((C as any).made));
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { v?: number; static { (this as any).made = new this().v; } }; }
  const C = Mix(Object);
  show("generic function, optional field, called", () => String((C as any).made));
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { v?: number; static { (this as any).made = new this().v; } }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, optional field, called twice", () => String((C as any).made));
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { v?: number; static { (this as any).made = new this().v; } };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, optional field, extended", () => String((C as any).made));
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { v?: number; static { (this as any).made = new this().v; } };
  const C = Mix(Object);
  show("generic arrow, optional field, called", () => String((C as any).made));
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { v?: number; static { (this as any).made = new this().v; } };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, optional field, called twice", () => String((C as any).made));
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { declare v: number; w = 1; }; }
  class S extends Mix(Object) {}
  const C = S;
  show("generic function, declared field, extended", () => Object.keys(new C()));
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { declare v: number; w = 1; }; }
  const C = Mix(Object);
  show("generic function, declared field, called", () => Object.keys(new C()));
}
{
  function Mix<TBase extends Ctor>(Base: TBase) { return class extends Base { declare v: number; w = 1; }; }
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic function, declared field, called twice", () => Object.keys(new C()));
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { declare v: number; w = 1; };
  class S extends Mix(Object) {}
  const C = S;
  show("generic arrow, declared field, extended", () => Object.keys(new C()));
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { declare v: number; w = 1; };
  const C = Mix(Object);
  show("generic arrow, declared field, called", () => Object.keys(new C()));
}
{
  const Mix = <TBase extends Ctor>(Base: TBase) => class extends Base { declare v: number; w = 1; };
  const C0 = Mix(Object);
  const C = Mix(class P {});
  show("generic arrow, declared field, called twice", () => Object.keys(new C()));
}
const log: string[] = [];
function field(v: undefined, c: ClassFieldDecoratorContext) { c.addInitializer(function () { log.push("init " + String(c.name)); }); return (x: number) => x + 1; }
function method(f: Function, c: ClassMethodDecoratorContext) { c.addInitializer(function () { log.push("bound " + String(c.name)); }); return function (this: any, ...a: any[]) { log.push("call"); return f.apply(this, a); }; }
function cls(k: Function, c: ClassDecoratorContext) { c.addInitializer(function () { log.push("class " + (this === k)); }); }
function acc(v: ClassAccessorDecoratorTarget<any, number>, c: ClassAccessorDecoratorContext) { return { init(x: number) { return x * 10; } }; }
{
  const make = () => class { @field v = 1; };
  class S extends make() {}
  show("decorated field", () => [new S().v, new S().v, log.splice(0).join()]);
}
{
  const make = () => class { @method m() { return 2; } };
  class S extends make() {}
  show("decorated method", () => [new S().m(), log.splice(0).join()]);
}
{
  const make = () => class { @field static v = 1; static { (this as any).t = this.v; } };
  class S extends make() {}
  show("decorated static field", () => [S.v, (S as any).t, log.splice(0).join()]);
}
{
  const make = () => class { @acc accessor v = 2; };
  class S extends make() {}
  show("decorated accessor field", () => new S().v);
}
{
  const make = () => { @cls class K { static n = 1; } return K; };
  class S extends make() {}
  show("decorated class", () => [S.n, log.splice(0).join()]);
}
{
  const make = () => class { @field #v = 1; read() { return this.#v; } };
  class S extends make() {}
  show("decorated private field", () => [new S().read(), log.splice(0).join()]);
}
{
  const make = (n: number) => class { @field v = n; };
  const A = make(1), B = make(10);
  show("decorated field, two calls", () => [new A().v, new B().v, log.splice(0).join()]);
}
{
  const make = (add: number) => { const d = (v: undefined, c: ClassFieldDecoratorContext) => (x: number) => x + add; return class { @d v = 1; }; };
  class S extends make(5) {}
  class T extends make(50) {}
  show("the decorator is a closure of the factory", () => [new S().v, new T().v]);
}

// GENERATED: show T init K #v
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v3 = Builtin builtin=JSON
// CHECK-NEXT: v4 = PropGet v3 key="stringify"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v1 calleeName="f"
// CHECK-NEXT: v7 = Call v5, v3, v6 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = PropGet v9 key="constructor"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="name"
// CHECK-NEXT: Jump -> next b6(v12)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string=": "
// CHECK-NEXT: v20 = Add v0, v19
// CHECK-NEXT: v21 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v22 = Add v20, v21
// CHECK-NEXT: v23 = Call v18, v16, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="T"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="init"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_8]]}] results=[{type=number site=[[w_9]]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=10
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_12]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#v"
// CHECK: module=[[m_0]] position={{*}} kind=Method flags=[HasThis, IsChecked] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateHas v1, v0 layout=[[L_13]] field=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#v"
// CHECK: module=[[m_0]] position={{*}} kind=Getter flags=[HasThis, IsChecked] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateGet v1, v0 layout=[[L_13]] field=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#v"
// CHECK: module=[[m_0]] position={{*}} kind=Setter flags=[HasThis, IsChecked] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_14]]} illTypedCause=FromLooseType
// CHECK-NEXT: PrivateSet v1, v0, v3 layout=[[L_13]] field=1
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
