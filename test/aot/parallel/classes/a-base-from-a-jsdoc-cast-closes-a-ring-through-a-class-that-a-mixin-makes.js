// Flags: --aot-validate
// Alone: its build ends with an internal error, which the programs beside it would share
// Todo: the build ends with InvalidLayout. The cast names B as the base of A, B extends what the mixin makes below A, and the bases close a ring (oven-sh/WebKit#980, "What stays"). Without --aot-validate the executable never returns.
// A class extends a value that a JSDoc cast gives the type of a second class, and the second class extends what a mixin makes below the first.
const early = process.argv.length < 5;
class Root {
  r() {
    return 0;
  }
}
const mix = Base =>
  class extends Base {
    m() {
      return 1;
    }
  };
function pick() {
  return early ? Root : B;
}
class A extends /** @type {typeof B} */ (pick()) {
  a() {
    return 1;
  }
}
class B extends mix(A) {
  b() {
    return 2;
  }
}
class C extends mix(Root) {
  c() {
    return 3;
  }
}
A.prototype.late = 4;
const p = B.prototype;
console.log(p.late, p.a(), p.b(), p.m(), p.r(), new C().c(), new C().m());
