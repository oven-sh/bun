function attempt(what: string, run: () => unknown) {
  try {
    console.log(what, JSON.stringify(run()));
  } catch (error) {
    console.log(what, "throws", (error as Error).constructor.name);
  }
}
const describe = (made: object, key: string) => {
  const found = Object.getOwnPropertyDescriptor(made, key);
  return found ? [typeof found.get, typeof found.set, found.value ?? null, found.enumerable, found.configurable] : null;
};
// Every case has a literal with a name of its own, and so a layout of its own.
attempt("read through an heir made by Object.create", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only1: 0,
  };
  const heir = Object.create(made);
  return [heir.first, made.first, Object.keys(heir).join(), "first" in heir, Object.hasOwn(heir, "first")];
});
attempt("the getter sees the heir", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only2: 0,
  };
  const heir = Object.create(made);
  heir.lead = 5;
  return [heir.first, made.first, Object.keys(heir).join()];
});
attempt("a store by name into an heir of a getter alone", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only3: 0,
  };
  const heir = Object.create(made);
  heir.first = 5;
  return heir.first;
});
attempt("a store by name into an heir of a getter and a setter", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    set first(value: number) {
      this.lead = value * 10;
    },
    lead: 1,
    only4: 0,
  };
  const heir = Object.create(made);
  heir.first = 5;
  return [heir.first, heir.lead, made.first, made.lead, Object.keys(heir).join()];
});
attempt("put above by Object.setPrototypeOf", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only5: 0,
  };
  const heir = Object.setPrototypeOf({ lead: 7 }, made);
  return [heir.first, made.first, Object.keys(heir).join()];
});
attempt("put above by __proto__ in a literal", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only6: 0,
  };
  const heir = { __proto__: made, lead: 8 } as unknown as typeof made;
  return [heir.first, made.first, Object.keys(heir).join()];
});
attempt("put above as the prototype of a constructor function", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only7: 0,
  };
  function Heir(this: any) {
    this.lead = 9;
  }
  Heir.prototype = made;
  const heir = new (Heir as any)();
  return [heir.first, made.first, heir instanceof (Heir as any)];
});
attempt("two above", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only8: 0,
  };
  const middle = Object.create(made);
  middle.lead = 3;
  const heir = Object.create(middle);
  return [heir.first, middle.first, made.first];
});
attempt("read often through the heir and on the object itself", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only9: 0,
  };
  const heir = Object.create(made);
  heir.lead = 2;
  let sum = 0;
  for (let turn = 0; turn < 300; turn++) sum += heir.first + made.first + made.lead;
  return sum;
});
attempt("a value defined over the getter while heirs read it", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only10: 0,
  };
  const heir = Object.create(made);
  let sum = 0;
  for (let turn = 0; turn < 300; turn++) {
    sum += heir.first + made.first;
    if (turn === 150) Object.defineProperty(made, "first", { value: 100 });
  }
  return [sum, describe(made, "first")];
});
attempt("the getter deleted while heirs read it", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only11: 0,
  };
  const heir = Object.create(made);
  let seen = 0;
  for (let turn = 0; turn < 300; turn++) {
    if (heir.first === undefined) seen++;
    if (turn === 150) delete (made as any).first;
  }
  return [seen, "first" in heir, describe(made, "first")];
});
attempt("the heir defines a value of its own under the name", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only12: 0,
  };
  const heir = Object.create(made);
  Object.defineProperty(heir, "first", { value: 4, enumerable: true });
  return [heir.first, made.first, Object.keys(heir).join()];
});
attempt("names listed by for-in over the heir", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only13: 0,
  };
  const heir = Object.create(made);
  heir.mine = 1;
  const names: string[] = [];
  for (const name in heir) names.push(name);
  return names;
});
attempt("spread and JSON of the heir and of the object", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only14: 0,
  };
  const heir = Object.create(made);
  heir.mine = 1;
  return [{ ...heir }, JSON.stringify(heir), { ...made }, JSON.stringify(made)];
});
attempt("Reflect.get with another receiver", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only15: 0,
  };
  Object.create(made);
  return [Reflect.get(made, "first", { lead: 40 }), Reflect.get(Object.create(made), "first", { lead: 50 })];
});
attempt("super in a getter of the heir", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only16: 0,
  };
  const heir = {
    __proto__: made,
    lead: 20,
    get first(): number {
      return super.first + 100;
    },
  };
  return [heir.first, made.first];
});
attempt("super in a setter of the heir", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    set first(value: number) {
      this.lead = value * 10;
    },
    lead: 1,
    only17: 0,
  };
  const heir = {
    __proto__: made,
    lead: 20,
    set first(value: number) {
      super.first = value + 1;
    },
    get first(): number {
      return super.first;
    },
  };
  heir.first = 2;
  return [heir.first, heir.lead, made.lead];
});
attempt("the chain changed behind the reads", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only18: 0,
  };
  const heir = Object.create(made);
  let sum = 0;
  for (let turn = 0; turn < 300; turn++) {
    sum += heir.first ?? 1000;
    if (turn === 150) Object.setPrototypeOf(heir, { lead: 0 });
  }
  return sum;
});
attempt("frozen, then put above", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only19: 0,
  };
  const heir = Object.create(Object.freeze(made));
  return [heir.first, Object.isFrozen(made), describe(made, "first")];
});
attempt("an heir handed to a function that reads any object", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only20: 0,
  };
  const read = (one: { first: number; lead: number }) => one.first + one.lead;
  const heir = Object.create(made);
  let sum = 0;
  for (let turn = 0; turn < 300; turn++) sum += read(turn % 2 ? heir : made) + read({ first: 1, lead: 1 });
  return sum;
});
