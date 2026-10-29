// A field is replaced through a wider type, and its method is called through a list that holds the object.
// Flags: --aot-verify-each-pass
(() => {
let trail = "";
function str(v: unknown): string {
  return String(v);
}
class Inner {
  w(): number {
    return 99;
  }
}
class OtherInner {
  w(): string {
    return "other";
  }
}
class A {
  inner = new Inner();
}
function make(): A {
  return Object.assign({}, new A());
}
function run(): void {
let seen = "";
const o: A = make();
const list: Array<A> = [o];
try {
const changed: { inner?: unknown } = o;
changed.inner = new OtherInner();
seen = str(list[0].inner.w());
} catch (e) {
}
trail = "";
}
try {
run();
} catch (e) {
}
})();
