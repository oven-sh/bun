// RUN: lower
// OPTIONS: builtin-modules

// The clean-up callback of a registry does not run for an object that a live object refers to, also when no code reads the reference.
async function collect() {
  for (let i = 0; i < 4; i++) {
    await new Promise(done => setTimeout(done, 1));
    Bun.gc(true);
  }
}
async function count(name, make) {
  let cleaned = 0;
  const registry = new FinalizationRegistry(() => cleaned++);
  const holders = [];
  for (let i = 0; i < 500; i++) holders.push(make(i, o => (registry.register(o, i), o)));
  await collect();
  await collect();
  console.log(name, cleaned, holders.length);
}
await count("field", (i, watch) => {
  class Holder {
    constructor(o) {
      this.keep = o;
    }
  }
  return new Holder(watch({ i }));
});
await count("private field", (i, watch) => {
  class Holder {
    #keep;
    constructor(o) {
      this.#keep = o;
    }
  }
  return new Holder(watch({ i }));
});
await count("literal", (i, watch) => ({ keep: watch({ i }) }));
await count("list", (i, watch) => {
  const l = [];
  l.push(watch({ i }));
  return l;
});
await count("subscription", (i, watch) => {
  class Subscription {
    constructor(n) {
      this.n = n;
    }
  }
  class Component {
    constructor() {
      this.subscription = watch(new Subscription(i));
    }
  }
  return new Component();
});

// CHECK-LABEL: function {{*}}name="collect"
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK-LABEL: function {{*}}name="Holder"
