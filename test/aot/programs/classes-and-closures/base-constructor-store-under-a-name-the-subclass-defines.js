// A base constructor stores under a name that the subclass defines as a field. The definition runs later, so the store finds no own property and goes to what the object inherits:
// a setter runs, a getter alone or a read-only property throws in strict code. The field is there afterwards all the same.
class WithSetter {
  constructor(stores) {
    this.caught = "nothing";
    if (stores) this.guarded = "stored";
  }
  set guarded(value) {
    this.caught = "caught " + value;
  }
  get guarded() {
    return "from the getter";
  }
}
class DefinesOverSetter extends WithSetter {
  guarded = "defined";
}
class WithGetterAlone {
  constructor(stores) {
    this.thrown = "nothing";
    if (stores) {
      try {
        this.only = 1;
      } catch (error) {
        this.thrown = error.name;
      }
    }
  }
  get only() {
    return "getter";
  }
}
class DefinesOverGetter extends WithGetterAlone {
  only = "defined";
}
class WithReadOnly {
  constructor(stores) {
    this.thrown = "nothing";
    if (stores) {
      try {
        this.fixed = 1;
      } catch (error) {
        this.thrown = error.name;
      }
    }
  }
}
Object.defineProperty(WithReadOnly.prototype, "fixed", { value: "read-only", writable: false });
class DefinesOverReadOnly extends WithReadOnly {
  fixed = "defined";
}
class Free {
  constructor(stores) {
    if (stores) this.free = "stored";
    this.seen = this.free;
  }
}
class DefinesFree extends Free {
  free = "defined";
}
for (const stores of [true, false]) {
  const a = new DefinesOverSetter(stores);
  console.log(a.caught, a.guarded, Object.keys(a).join());
  const b = new DefinesOverGetter(stores);
  console.log(b.thrown, b.only, Object.keys(b).join());
  const c = new DefinesOverReadOnly(stores);
  console.log(c.thrown, c.fixed, Object.keys(c).join());
  const d = new DefinesFree(stores);
  console.log(d.seen, d.free, Object.keys(d).join());
  const e = new WithSetter(stores);
  console.log(e.caught, e.guarded, Object.keys(e).join());
}
let caught = 0;
for (let i = 0; i < 20000; i++) {
  if (new DefinesOverSetter(i & 1).caught !== "nothing") caught++;
  if (new DefinesOverGetter(i & 1).thrown !== "nothing") caught++;
  if (new DefinesOverReadOnly(i & 1).thrown !== "nothing") caught++;
}
console.log(caught);
