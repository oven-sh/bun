// Reads and stores through super in constructors and methods of classes whose class above is a proxy. Plain Bun prints another output.
function attempt(label, run) {
  try {
    console.log(label + ":", JSON.stringify(run()));
  } catch (error) {
    console.log(label + ":", "THROWS", error.constructor.name);
  }
}
class Above {
  m() {
    return "Above.m";
  }
}
attempt(
  "a store through super in a constructor, below a proxy",
  () =>
    new (class extends (new Proxy(Above, {})) {
      constructor() {
        super();
        super.stored = 1;
      }
    })(),
);
attempt(
  "a store through this in a constructor, below a proxy",
  () =>
    new (class extends (new Proxy(Above, {})) {
      constructor() {
        super();
        this.stored = 1;
      }
    })(),
);
attempt(
  "a read through super in a constructor, below a proxy",
  () =>
    new (class extends (new Proxy(Above, {})) {
      constructor() {
        super();
        this.read = super.m();
      }
    })(),
);
attempt("a store through super in a method, below a proxy", () => {
  const made = new (class extends (new Proxy(Above, {})) {
    store() {
      super.stored = 1;
    }
  })();
  made.store();
  return made;
});
attempt(
  "a store through super in a constructor, below the class",
  () =>
    new (class extends Above {
      constructor() {
        super();
        super.stored = 1;
      }
    })(),
);
/* Output:
a store through super in a constructor, below a proxy: {"stored":1}
a store through this in a constructor, below a proxy: {"stored":1}
a read through super in a constructor, below a proxy: {"read":"Above.m"}
a store through super in a method, below a proxy: {"stored":1}
a store through super in a constructor, below the class: {"stored":1}
*/
