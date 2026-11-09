// A store through `super` in an arrow function of a derived constructor, with the super() in its key or in its value.
// Plain Bun asks for `this` in front of the key: the store throws and the base constructor does not run.
// Todo: an executable asks for `this` at the store, behind the key and the value, so the base constructor runs and the store is done. The Super arm of lower_member_reference (src/aot/lower/member/reference.rs) gets the check with WebKit/WebKit#76967
let baseCalls = 0;
class Base {
  constructor() {
    baseCalls++;
  }
  set setter(value) {
    this.stored = value;
  }
}
Base.prototype.count = 1;

class Derived extends Base {
  constructor(name) {
    const initialize = () => {
      super();
    };
    const stores = {
      byName: () => {
        super.setter = (initialize(), 1);
      },
      byKey: () => {
        super[(initialize(), "setter")] = 1;
      },
      byKeyWithTheCallInTheValue: () => {
        super["setter"] = (initialize(), 1);
      },
      compound: () => {
        super[(initialize(), "count")] += 1;
      },
      increment: () => {
        super[(initialize(), "count")]++;
      },
      deleted: () => delete super[(initialize(), "count")],
      pattern: () => {
        [super[(initialize(), "a")]] = [1];
      },
      forOf: () => {
        for (super[(initialize(), "last")] of [1]);
      },
      forIn: () => {
        for (super[(initialize(), "key")] in { k: 0 });
      },
    };
    let said = "stored";
    try {
      stores[name]();
    } catch (error) {
      said = error.constructor.name;
    }
    console.log(name + ":", said + ", the base constructor ran", baseCalls, "times");
    if (!baseCalls) initialize();
    baseCalls = 0;
  }
}

for (const name of [
  "byName",
  "byKey",
  "byKeyWithTheCallInTheValue",
  "compound",
  "increment",
  "deleted",
  "pattern",
  "forOf",
  "forIn",
]) {
  new Derived(name);
}
