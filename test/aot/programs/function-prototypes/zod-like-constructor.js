// A constructor is put together at run time as zod does: a plain function whose prototype object is read, with an initializer hung on it by Object.defineProperty.
function $constructor(name, initializer) {
  function init(inst, def) {
    Object.defineProperty(inst, "_zod", { value: inst._zod ?? {}, enumerable: false });
    inst._zod.traits ??= new Set();
    inst._zod.traits.add(name);
    initializer(inst, def);
    const proto = _.prototype;
    for (const k of Object.keys(proto)) if (!(k in inst)) inst[k] = proto[k].bind(inst);
    inst._zod.constr = _;
    inst._zod.def = def;
  }
  class Definition extends Object {}
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = this;
    init(inst, def);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, { value: inst => inst?._zod?.traits?.has(name) });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
const Text = $constructor("Text", (inst, def) => { inst.check = value => typeof value === def.type; });
const Wide = $constructor("Wide", (inst, def) => { Text.init(inst, def); inst.wide = true; });
Text.prototype.describe = function () { return "a " + this._zod.def.type; };
const text = new Text({ type: "string" }), wide = new Wide({ type: "number" });
console.log(text.check("s"), text.check(1), wide.check(1), text.describe(), typeof wide.describe, wide instanceof Text, text instanceof Wide, Text.name, [...wide._zod.traits].join());
