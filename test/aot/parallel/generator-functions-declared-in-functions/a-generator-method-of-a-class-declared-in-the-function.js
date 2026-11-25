const n = +process.argv[2] || 3;
function f() {
  class C { *m() { yield n; } static *s() { yield n; } }
  const a = () => new C().m(), b = () => new C().m(), c = () => C.s(), d = () => C.s();
  return [Object.getPrototypeOf(a()) === Object.getPrototypeOf(b()), Object.getPrototypeOf(c()) === Object.getPrototypeOf(d())].join();
}
console.log(String(f()));
