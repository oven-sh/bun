// `new.target` in the text of a direct eval. `module.exports` makes this file CommonJS, so plain functions are sloppy and the module body is a function.
module.exports = {};

function show(value) { return typeof value === "function" ? "function " + value.name : String(value); }
function row(name, run) { try { console.log(name + ": " + show(run())); } catch (error) { console.log(name + ": throws " + error.name); } }

function Plain() { return { target: eval("new.target") }; }
function Other() {}
class Base { constructor() { this.target = eval("new.target"); } }
class Child extends Base {}
class Derived extends Base {
  constructor() {
    const before = eval("new.target");
    super();
    this.before = before;
    this.after = eval("new.target");
  }
}

row("function with new", () => new Plain().target);
row("function without new", () => Plain().target);
row("function with call", () => Plain.call({}).target);
row("compared in the text", () => new (function Compared() { return { same: eval("new.target === Compared") }; })().same);
row("base constructor", () => new Base().target);
row("inherited constructor", () => new Child().target);
row("derived constructor before super", () => new Derived().before);
row("derived constructor after super", () => new Derived().after);
row("value from base through derived", () => new Derived().target);
row("Reflect.construct of function", () => Reflect.construct(Plain, [], Other).target);
row("Reflect.construct of base", () => Reflect.construct(Base, [], Other).target);
row("Reflect.construct of derived before super", () => Reflect.construct(Derived, [], Other).before);
row("Reflect.construct of derived after super", () => Reflect.construct(Derived, [], Other).after);

function InArrow() { const read = () => eval("new.target"); return { target: read() }; }
class ArrowBeforeSuper extends Base {
  constructor() {
    const read = () => eval("new.target");
    const before = read();
    super();
    this.before = before;
  }
}
row("arrow in function with new", () => new InArrow().target);
row("arrow in function without new", () => InArrow().target);
row("arrow in derived constructor", () => new ArrowBeforeSuper().before);
row("arrow in the text", () => new (function ArrowText() { return { target: eval("(() => new.target)()") }; })().target);

function Nested() { return { target: eval("eval('new.target')") }; }
row("nested eval with new", () => new Nested().target);
row("nested eval without new", () => Nested().target);

function LocalTarget() {
  let target = "local";
  const before = eval("target");
  eval("target = 'stored'");
  return { seen: [before, target, eval("target"), show(eval("new.target"))].join(" ") };
}
row("local named target with new", () => new LocalTarget().seen);
row("local named target without new", () => LocalTarget().seen);
row("store to new.target", () => new (function Store() { return { target: eval("new.target = 1") }; })().target);

function deleteBound(x) { return [eval("delete x"), eval("x"), eval("delete unboundName")].join(" "); }
function deleteStrict(x) { "use strict"; return eval("delete x"); }
row("delete in sloppy code", () => deleteBound(1));
row("delete in strict code", () => deleteStrict(1));

try { console.log("module body: " + show(eval("new.target"))); } catch (error) { console.log("module body: throws " + error.name); }
row("arrow in module body", () => eval("new.target"));
row("field initializer in module body", () => new (class { seen = eval("new.target"); })().seen);
