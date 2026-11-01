const hidden = (text: string) => text.split("~").join("");
const handBack = new Function("value", hidden("ret~urn value")) as <T>(value: T) => T;

function attempt(what: string, run: () => unknown) {
  try {
    console.log(what, JSON.stringify(run()));
  } catch (error) {
    console.log(what, "throws", (error as Error).constructor.name);
  }
}
const describe = (made: object, key: string) => {
  const found = Object.getOwnPropertyDescriptor(made, key)!;
  return [typeof found.get, typeof found.set, found.value ?? null, found.enumerable, found.configurable, Object.keys(made).join()];
};
// Every case has a literal with a name of its own, and so a layout of its own: what one case does to its object says nothing of another's.
attempt("assign onto a getter alone", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only1: 0,
  };
  Object.assign(made, handBack({ first: 5 }));
  return made.first;
});
attempt("assign beside a getter alone", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only2: 0,
  };
  Object.assign(made, handBack({ lead: 5 }));
  return [made.first, describe(made, "first")];
});
attempt("assign onto a getter alone, then read", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only3: 0,
  };
  try {
    Object.assign(made, handBack({ first: 5 }));
  } catch {}
  return [made.first, describe(made, "first")];
});
attempt("assign onto a getter and a setter", () => {
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
  Object.assign(made, handBack({ first: 5 }));
  return [made.first, made.lead, describe(made, "first")];
});
attempt("assign of a new name beside a getter", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only5: 0,
  };
  Object.assign(made, handBack({ other: 5 }));
  return [made.first, describe(made, "first")];
});
attempt("store onto a getter alone", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only6: 0,
  };
  (made as any)[handBack("first")] = 5;
  return made.first;
});
attempt("store onto a getter alone, then read", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only7: 0,
  };
  try {
    (made as any)[handBack("first")] = 5;
  } catch {}
  return [made.first, describe(made, "first")];
});
attempt("store beside a getter alone", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only8: 0,
  };
  (made as any)[handBack("lead")] = 5;
  return [made.first, describe(made, "first")];
});
attempt("store onto a getter and a setter", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    set first(value: number) {
      this.lead = value * 10;
    },
    lead: 1,
    only9: 0,
  };
  (made as any)[handBack("first")] = 5;
  return [made.first, made.lead, describe(made, "first")];
});
attempt("store of a new name beside a getter", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only10: 0,
  };
  (made as any)[handBack("other")] = 5;
  return [made.first, describe(made, "first")];
});
attempt("stores in a loop over the keys of a source nobody knows", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    set first(value: number) {
      this.lead = value * 10;
    },
    lead: 1,
    only11: 0,
  };
  const source = handBack({ first: 5, lead: 6 }) as Record<string, number>;
  for (const key in source) (made as any)[key] = source[key];
  return [made.first, made.lead, describe(made, "first")];
});
attempt("Reflect.set onto a getter alone", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only12: 0,
  };
  return [Reflect.set(made, handBack("first"), 5), made.first, describe(made, "first")];
});
attempt("a value defined over a getter", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only13: 0,
  };
  Object.defineProperty(made, handBack("first"), { value: 5 });
  return [made.first, describe(made, "first")];
});
attempt("another getter defined over a getter", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only14: 0,
  };
  Object.defineProperty(made, handBack("first"), { get: () => 7 });
  return [made.first, describe(made, "first")];
});
attempt("assigned beside the getter, then a value defined over it", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only15: 0,
  };
  Object.assign(made, handBack({ lead: 5 }));
  Object.defineProperty(made, handBack("first"), { value: 9 });
  return [made.first, describe(made, "first")];
});
attempt("deleted, then stored", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only16: 0,
  };
  delete (made as any)[handBack("first")];
  (made as any)[handBack("first")] = 7;
  return [made.first, describe(made, "first")];
});
attempt("deleted, then assigned", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only17: 0,
  };
  delete (made as any)[handBack("first")];
  Object.assign(made, handBack({ first: 7 }));
  return [made.first, describe(made, "first")];
});
attempt("descriptors of another object defined over it", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only18: 0,
  };
  Object.defineProperties(made, Object.getOwnPropertyDescriptors(handBack({ first: 5 })));
  return [made.first, describe(made, "first")];
});
attempt("a store into an heir of a getter alone", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only19: 0,
  };
  const heir = Object.create(made);
  heir[handBack("first")] = 5;
  return heir.first;
});
attempt("a store into an heir of a getter and a setter", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    set first(value: number) {
      this.lead = value * 10;
    },
    lead: 1,
    only20: 0,
  };
  const heir = Object.create(made);
  heir[handBack("first")] = 5;
  return [heir.first, heir.lead, made.lead, Object.keys(heir).join()];
});
attempt("frozen, then assigned beside the getter", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only21: 0,
  };
  Object.assign(Object.freeze(made), handBack({ lead: 5 }));
  return made.first;
});
attempt("assigned where nobody sees it", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    set first(value: number) {
      this.lead = value * 10;
    },
    lead: 1,
    only22: 0,
  };
  (handBack(Object.assign) as typeof Object.assign)(handBack(made), { first: 5 });
  return [made.first, made.lead, describe(made, "first")];
});
attempt("a spread in front of the getter", () => {
  const made = {
    only23: 0,
    ...handBack({ first: 5, other: 6 }),
    get first() {
      return 8;
    },
  };
  return [made.first, describe(made, "first")];
});
attempt("a spread behind the getter", () => {
  const made = {
    only24: 0,
    get first() {
      return 8;
    },
    ...handBack({ first: 5, other: 6 }),
  };
  return [made.first, describe(made, "first")];
});
attempt("a computed key behind the getter", () => {
  const made = {
    only25: 0,
    get first() {
      return 8;
    },
    [handBack<string>("first")]: 9,
  };
  return [made.first, describe(made, "first")];
});
attempt("a computed key in front of the getter", () => {
  const made = {
    only26: 0,
    [handBack<string>("first")]: 9,
    get first() {
      return 8;
    },
  };
  return [made.first, describe(made, "first")];
});
attempt("Reflect.set through another object onto a receiver with a getter alone", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only41: 0,
  };
  return [Reflect.set(handBack({ first: 0 }), handBack("first"), 5, made), made.first, describe(made, "first")];
});
attempt("Reflect.set through an object with a getter alone onto another receiver", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only42: 0,
  };
  const receiver = handBack({ other: 1 }) as Record<string, number>;
  return [Reflect.set(made, handBack("first"), 5, receiver), made.first, Object.keys(receiver).join(), describe(made, "first")];
});
attempt("Reflect.set through an object with a setter onto another receiver", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    set first(value: number) {
      this.lead = value * 10;
    },
    lead: 1,
    only43: 0,
  };
  const receiver = handBack({ lead: 1 });
  return [Reflect.set(made, handBack("first"), 5, receiver), made.first, made.lead, receiver.lead, describe(made, "first")];
});
attempt("read often, stored onto, read again", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only44: 0,
  };
  let sum = 0;
  for (let turn = 0; turn < 300; turn++) {
    sum += made.first + made.lead;
    if (turn === 150) {
      try {
        (made as any)[handBack("first")] = 100;
      } catch {
        sum += 1000;
      }
      (made as any)[handBack("lead")] = 2;
    }
  }
  return [sum, describe(made, "first")];
});
attempt("read often, a value defined over it, read again", () => {
  const made = {
    get first() {
      return this.lead + 1;
    },
    lead: 1,
    only45: 0,
  };
  (made as any)[handBack("lead")] = 1;
  const define = handBack(Object.defineProperty);
  let sum = 0;
  for (let turn = 0; turn < 300; turn++) {
    sum += made.first + made.lead;
    if (turn === 150) define(handBack(made), "first", { value: 100 });
  }
  return [sum, describe(made, "first")];
});
class Held {
  lead = 1;
  get first() {
    return this.lead + 1;
  }
  set first(value: number) {
    this.lead = value * 10;
  }
}
attempt("assign onto an instance whose class has the accessor", () => {
  const made = Object.assign(new Held(), handBack({ first: 5 }));
  return [made.first, made.lead, Object.keys(made).join()];
});
attempt("assign onto the prototype object of a class", () => {
  class Own {
    lead = 1;
    get first() {
      return this.lead + 1;
    }
    set first(value: number) {
      this.lead = value * 10;
    }
  }
  Object.assign(Own.prototype, handBack({ first: 5 }));
  return [new Own().first, (Own.prototype as any).lead, typeof Object.getOwnPropertyDescriptor(Own.prototype, "first")!.get];
});
