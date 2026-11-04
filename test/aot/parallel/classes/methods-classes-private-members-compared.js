// Each method is read off an instance, off the prototype object, under a computed key and out of its descriptor.
// A line lists, for each read, the position of the first read that gave the same function object.
const symbol = Symbol("s");
const call = f => f();
function compare(label, reads) {
  console.log(label + ": " + reads.map(f => typeof f + " " + reads.indexOf(f)).join(", "));
}

function defineOnce() {
  class B {
    before() {}
    static fixedBefore() {}
    #p() {
      return 1;
    }
    viaPrivate() {
      return this.#p();
    }
    after() {}
    *generator() {}
    async later() {}
    [symbol]() {}
    7() {}
    get read() {
      return 1;
    }
    static viaStatic(o) {
      return o.#p();
    }
    static fixedAfter() {}
  }
  const o = new B();
  const P = B.prototype;
  const described = (holder, key) => call(() => Object.getOwnPropertyDescriptor(holder, key).value);
  compare("before", [
    described(P, "before"),
    call(() => o.before),
    call(() => P.before),
    call(() => o["before".slice(0)]),
  ]);
  compare("after", [described(P, "after"), call(() => o.after), call(() => P.after), call(() => o["after".slice(0)])]);
  compare("generator", [described(P, "generator"), call(() => o.generator), call(() => P.generator)]);
  compare("later", [described(P, "later"), call(() => o.later), call(() => P.later)]);
  compare("symbol", [described(P, symbol), call(() => o[symbol]), call(() => P[symbol])]);
  compare("index", [described(P, "7"), call(() => o[7]), call(() => P[7])]);
  compare("viaPrivate", [described(P, "viaPrivate"), call(() => o.viaPrivate), call(() => P.viaPrivate)]);
  compare("fixedBefore", [described(B, "fixedBefore"), call(() => B.fixedBefore)]);
  compare("fixedAfter", [described(B, "fixedAfter"), call(() => B.fixedAfter)]);
  compare("getter", [
    call(() => Object.getOwnPropertyDescriptor(P, "read").get),
    call(() => P.__lookupGetter__("read")),
  ]);
}
defineOnce();

function defineBelowAnother() {
  class A {
    #a = 1;
    base() {
      return this.#a;
    }
    shared() {}
    static made() {}
  }
  class B extends A {
    #b() {
      return 2;
    }
    own() {}
    viaPrivate() {
      return this.#b();
    }
  }
  const o = new B();
  compare("the instance first", [
    call(() => o.own),
    call(() => Object.getOwnPropertyDescriptor(B.prototype, "own").value),
    call(() => o["own".slice(0)]),
  ]);
  compare("inherited", [
    call(() => o.shared),
    call(() => Object.getOwnPropertyDescriptor(A.prototype, "shared").value),
    call(() => o["shared".slice(0)]),
    call(() => new A().shared),
  ]);
  compare("static, inherited", [
    call(() => B.made),
    call(() => A.made),
    call(() => Object.getOwnPropertyDescriptor(A, "made").value),
  ]);
}
defineBelowAnother();

new (class {
  run() {
    class B {
      f = 1;
      size(a, b) {}
      name(a, b) {}
      #p() {
        return 1;
      }
      viaPrivate() {
        return this.#p();
      }
    }
    const kept = [];
    const o = new B();
    const o2 = new B();
    const P = B.prototype;
    const step = f => {
      const value = f();
      if (typeof value === "function") kept.push(value);
    };
    step(() => JSON.stringify(Object.entries(P)));
    step(() => o["name".slice(0)]);
    step(() => o2.size);
    step(() => o2.name);
    step(() => Object.getOwnPropertyDescriptor(P, "size").value);
    compare("inside a method that runs once", kept);
  }
})().run();

function defineAgain(n) {
  class C {
    #c() {
      return n;
    }
    member() {}
    viaPrivate() {
      return this.#c();
    }
  }
  return new C();
}
const first = defineAgain(1);
const second = defineAgain(2);
compare("two evaluations", [
  call(() => first.member),
  call(() => second.member),
  call(() => first["member".slice(0)]),
  call(() => second["member".slice(0)]),
]);
