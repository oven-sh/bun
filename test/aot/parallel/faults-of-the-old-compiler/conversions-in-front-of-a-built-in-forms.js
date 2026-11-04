const cond = process.argv.length > 1;
const flags = () => ({ toString() { console.log("flags asked"); throw new RangeError("from flags"); } });
const tries = {
  plain: () => new RegExp(Symbol(), flags()),
  call: () => RegExp(Symbol(), flags()),
  apply: () => RegExp.apply(null, [Symbol(), flags()]),
  spread: () => new RegExp(...[Symbol(), flags()]),
  alias: () => { const R = RegExp; return new R(Symbol(), flags()); },
  symbolOrNumber: () => new RegExp(cond ? Symbol() : 1, flags()),
  symbolOrText: () => new RegExp(cond ? Symbol() : "a", flags()),
  construct: () => Reflect.construct(RegExp, [Symbol(), flags()]),
  subclass: () => new (class extends RegExp {})(Symbol(), flags()),
  object: () => new RegExp({ toString() { console.log("pattern asked"); return "a"; } }, flags()),
  text: () => new RegExp(Symbol(), "g"),
};
for (const name in tries) { try { console.log(name, String(tries[name]())); } catch (e) { console.log(name, e.name); } }
