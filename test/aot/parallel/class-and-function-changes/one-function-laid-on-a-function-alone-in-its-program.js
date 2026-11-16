// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the function laid on the function is asked again at run time
// One function laid on a function by a written, read-only descriptor. Alone in its program.
function make(name) {
  function init(inst, by) { inst.total += by.n; return inst.total; }
  function made() { return name; }
  Object.defineProperty(made, "init", { value: init });
  return made;
}
const one = make("one");
const holder = { total: 1 };
console.log(one.init(holder, { n: 2 }), one.init(holder, { n: 3 }), one());
