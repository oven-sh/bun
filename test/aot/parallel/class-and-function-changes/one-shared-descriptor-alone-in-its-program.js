// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the field that the descriptor fills is asked again at run time
// One record that a constant holds is the descriptor of every definition: its `value` is stored anew before each call and emptied behind it. Alone in its program.
const shared = { value: undefined, enumerable: false };
function make(kind) {
  const made = {};
  shared.value = { kind, seen: 0 };
  Object.defineProperty(made, "inner", shared);
  shared.value = undefined;
  made.inner.run = payload => { made.inner.seen++; return payload.value + 1; };
  return made;
}
const one = make("first");
console.log(one.inner.run({ value: 1 }), one.inner.seen);
