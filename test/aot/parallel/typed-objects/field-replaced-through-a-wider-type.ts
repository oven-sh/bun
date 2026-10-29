// Flags: --aot-check=verify-each-pass
// A field is replaced through a wider type, and a method of what the list then holds is called for a text that nothing reads.
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
    } catch (e) {}
    trail = "";
  }
  try {
    run();
  } catch (e) {}
})();
console.log("ran");
