// plain: true true | g0 (no mend): false .. | g1: true true if `async function*` bears Flags::GENERATOR (read: sema/hir.rs:1004-1005: two flags, both set)
const n = +process.argv[2] || 3;
function f() {
  "use strict";
  async function* pages() { yield n; }
  const a = () => pages(), b = () => pages();
  const first = a(), second = b();
  Object.getPrototypeOf(first).mark = n;
  return String(Object.getPrototypeOf(first) === Object.getPrototypeOf(second)) + " " + String(second.mark === n);
}
console.log(f());
