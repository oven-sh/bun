// What a toString() or valueOf() that throws lists in its stack, by the way that the object is turned into a primitive.
const names = error => error.stack.split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ \(.*/, "").replace(/ unknown$/, "").replace(/.*\.mjs:\d+:\d+$/, "module"));
class Text { toString() { throw new RangeError("text"); } }
class Value { valueOf() { throw new RangeError("value"); } }
class Deep { toString() { return inner(this); } }
function inner(o) { throw new TypeError("deep"); }
class Objects { toString() { return {}; } valueOf() { return {}; } }
class Symbols { toString() { return Symbol("s"); } }
class Mixed { toString() { return this; } valueOf() { throw new EvalError("mixed"); } }
const makers = { text: () => new Text(), value: () => new Value(), deep: () => new Deep(), objects: () => new Objects(), symbols: () => new Symbols(), mixed: () => new Mixed() };
const uses = {
  string(o) { return String(o); }, template(o) { return `<${o}>`; }, before(o) { return "a" + o; }, after(o) { return o + "a"; }, number(o) { return o + 1; }, twice(o) { return o + o; }, minus(o) { return o - 1; }, key(o) { return {}[o]; }, joined(o) { return [o].join(); }, loop(o) { let r = ""; for (let i = 0; i < 2; i++) r += o; return r; }, called(o) { return o.toString(); },
};
function outer(use, o) { return use(o); }
for (let turn = 0; turn < 2; turn++)
  for (const [name, make] of Object.entries(makers))
    for (const [use, act] of Object.entries(uses)) { try { const value = outer(act, make()); console.log(name, use, typeof value); } catch (error) { console.log(name, use, error.constructor.name, error.message.replace(/ \(evaluating.*/, ""), names(error).slice(0, 5).join(" < ")); } }
