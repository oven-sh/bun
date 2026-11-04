// A class without a written constructor whose decorated members leave work to the constructor: `bun run` writes one, and its frames are shown at `class`.
// Where a plain field takes that work, it writes none, and the frame has no file. Only frames of this file and of no file are printed.
const frames = () => new Error("x").stack!.split("\n").slice(2).map(line => line.trim().replace(/\(.*[\\/]/, "(").replace(/^at .*[\\/]/, "at ")).filter(line => /is-shown-at-its-class|unknown/.test(line)).join(" < ");
const show = (what: string) => console.log(what + ": " + frames());
const value = (what: string) => (v: undefined, c: ClassFieldDecoratorContext) => (x: number) => { show(what); return x; };
const later = (what: string) => (v: unknown, c: DecoratorContext) => { c.addInitializer(function () { show(what); }); };
const stored = (what: string) => (v: ClassAccessorDecoratorTarget<unknown, number>, c: ClassAccessorDecoratorContext) => ({ init(x: number) { show(what); return x; } });
class Field { @value("a field") g = 2; }
new Field();
class FieldLater { @later("addInitializer of a field") g = 2; }
new FieldLater();
class Accessor { @stored("init of an accessor") accessor g = 2; }
new Accessor();
class Method { @later("addInitializer of a method") f() {} }
new Method();
class MethodAndField { @later("a method beside a plain field") f() {} g = 1; }
new MethodAndField();
class FieldThenPlain { @value("a field in front of a plain field") g = 2; h = 3; }
new FieldThenPlain();
class PlainThenField { h = 3; @value("a field behind a plain field") g = 2; }
new PlainThenField();
class Below extends Field { @value("a field of a derived class") k = 2; }
new Below();
const Named = class Inner { @value("a named class expression") g = 2; };
new Named();
const whole = (v: unknown, c: ClassDecoratorContext) => {};
@whole class Whole { @value("below a class decorator") g = 2; }
new Whole();
export class Exported { @value("an exported class") g = 2; }
new Exported();
class StaticOnly { @value("a static field") static g = 2; h = (show("a plain field beside a decorated static one"), 1); }
new StaticOnly();
class Private { @value("a private field") #g = 2; }
new Private();
class Written { @value("a written constructor") g = 2; constructor() { show("in the written constructor"); } }
new Written();
