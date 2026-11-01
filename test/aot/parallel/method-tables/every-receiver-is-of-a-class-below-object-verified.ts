// Flags: --aot-check=verify-each-stage
// Each class that defines the method stands below `extends Object`, and the method table serves no such object: the call is not sent through it.
function main() { try {
    const log: string[] = [];
    for (let hot = 0; hot < 1; hot++) {
      class A extends Object { constructor() { super(); }
        [k: string]: any;
      }
      class B extends A { }
      class C extends B { m(): string { return "C"; } }
      class D extends A { m(): string { return "D" + this.t; } }
      const list: A[] = [new C, new B, new D, new A];
      try { log.push(list.map(o => o.m()).join()); } catch (e) { log.push("!"); }
      try { Object.defineProperty(C.prototype, "m", { value: function () { return "d" + this.t; }, configurable: true, writable: true }); } catch (e) { log.push("!"); }
      log.push(list[0].m());
    }
    const $t: string = log.join(" "); console.log($t); return $t;
} catch (__e) { } }
main();
