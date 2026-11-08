// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the fields of the descriptor itself is asked at run time
// One descriptor whose value is stored behind its birth, alone in its program: beside other descriptors its layout has writers that nobody sees, and a field of it that is wrongly held to be never written does not show.
function make(kind) {
  const made = {};
  Object.defineProperty(made, "inner", { enumerable: false, value: { kind, seen: 0 } });
  made.inner.run = payload => { made.inner.seen++; return payload.value + 1; };
  return made;
}
const one = make("first");
console.log(one.inner.run({ value: 1 }), one.inner.seen);
