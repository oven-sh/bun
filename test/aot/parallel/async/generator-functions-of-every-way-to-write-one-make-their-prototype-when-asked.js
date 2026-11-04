// Generator functions of every way to write one: each has a `prototype` of its own, made when somebody asks; their generators are asked first, or the function is, or nobody is until one is changed.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
const generatorPrototype = Object.getPrototypeOf(function* () {}).prototype;
function makers(tag) {
  const key = Symbol("key");
  class Holder {
    *instance() { yield tag + "i"; }
    static *fixed() { yield tag + "s"; }
    *[Symbol.iterator]() { yield tag + "it"; }
    *[key]() { yield tag + "k"; }
    static #hidden = function* () { yield tag + "h"; };
    static hidden() { return Holder.#hidden; }
  }
  const literal = { *method() { yield tag + "m"; }, property: function* () { yield tag + "p"; }, *["computed" + tag]() { yield tag + "c"; } };
  const named = function* inner() { yield typeof inner; };
  function* declared() { yield tag + "d"; }
  const withDefault = function* (a = tag) { yield a; };
  const withRest = function* (...all) { yield all.length; };
  const usesArguments = function* () { yield arguments.length; };
  const usesThis = function* () { yield this === undefined ? "none" : typeof this; };
  const holder = new Holder();
  return hide([Holder.prototype.instance, Holder.fixed, Holder.prototype[Symbol.iterator], Holder.prototype[key], Holder.hidden(), literal.method, literal.property, literal["computed" + tag], named, declared, withDefault, withRest, usesArguments, usesThis, declared.bind(null), holder.instance.bind(holder)]);
}
const out = [];
for (const order of ["the generator first", "the function first", "nobody until a change"]) {
  const functions = makers(order[4]);
  const rows = functions.map((f, index) => {
    const g = hide(f(1, 2));
    const target = index >= functions.length - 2 ? undefined : f;
    if (order === "the function first" && target) hide(target.prototype);
    if (order === "nobody until a change") return [g, target];
    const prototype = Object.getPrototypeOf(g);
    return [target ? prototype === target.prototype : "bound", Object.getPrototypeOf(prototype) === generatorPrototype, Object.getOwnPropertyNames(prototype).length, target ? g instanceof target : "bound", Object.hasOwn(f, "prototype"), String(g.next().value)].join();
  });
  if (order === "nobody until a change") {
    rows[9][1].prototype.extra = "added";
    out.push(order + ": " + rows.map(([g, target]) => [g.extra, target ? Object.getPrototypeOf(g) === target.prototype : "bound", String(g.next().value)].join()).join(" | "));
  } else out.push(order + ": " + rows.join(" | "));
}
console.log(out.join("\n"));
