// Decorators are evaluated where keys are: `bun run` prints them inside the next key that is no private name, or behind the last one. A getter or setter under such a key is named when
// the class is evaluated, as under any computed key, and its frames say `get a`, `set a`. Under a key as written they say `a`.
const top = () => new Error().stack!.split("\n")[2].trim().replace(/\(.*[\/\\]/, "(").replace(/:\d+:\d+/, "");
const keeps = (value: any, context: any) => {};
class Own { @keeps get a() { console.log("decorated itself:", top()); return 1; } get b() { console.log("behind a decorated one:", top()); return 1; } }
new Own().a; new Own().b;
class BehindPrivate { @keeps #x = 1; get a() { console.log("behind a decorated private field:", top()); return 1; } get b() { console.log("the second behind it:", top()); return 1; } }
new BehindPrivate().a; new BehindPrivate().b;
class InFrontOfPrivate { get a() { console.log("the first, two in front of a decorated private field:", top()); return 1; } get b() { console.log("the last key in front of a decorated private field:", top()); return 1; } @keeps #x = 1; }
new InFrontOfPrivate().a; new InFrontOfPrivate().b;
class BehindField { @keeps f = 1; get a() { console.log("behind a decorated field:", top()); return 1; } }
new BehindField().a;
class Static { @keeps static get a() { console.log("a decorated static getter:", top()); return 1; } @keeps static set a(v) { console.log("a decorated static setter:", top()); } }
Static.a; Static.a = 1;
@keeps class Whole { get a() { console.log("below a class decorator alone:", top()); return 1; } }
new Whole().a;
class WithConstructor { @keeps #x = 1; constructor() {} get a() { console.log("behind a private one and a constructor:", top()); return 1; } }
new WithConstructor().a;
class WithBlock { @keeps #x = 1; static {} get a() { console.log("behind a private one and a static block:", top()); return 1; } }
new WithBlock().a;
class Accessor { @keeps accessor v = 1; get a() { console.log("behind a decorated accessor:", top()); return 1; } }
new Accessor().a;
class Names { @keeps get a() { return 1; } @keeps m() {} }
console.log(Object.getOwnPropertyDescriptor(Names.prototype, "a")!.get!.name, Names.prototype.m.name, Object.getOwnPropertyNames(Names.prototype.m).join());
