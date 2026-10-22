// A store to `this` under a name that a base class declares as an accessor runs the accessor and adds no own property, in a typed class as in untyped code.
const events: string[] = [];

class Root {
  set stored(value: number) {
    events.push("set stored " + value);
  }
}

class Base extends Root {
  #both = 0;
  get computed(): string {
    return "computed";
  }
  get both(): number {
    return this.#both;
  }
  set both(value: number) {
    events.push("set both " + value);
    this.#both = value * 2;
  }
}

class Derived extends Base {
  constructor(value: number) {
    super();
    this.stored = value;
    this.both = value;
    (this as any).own = value;
    try {
      (this as any).computed = value;
    } catch (error) {
      events.push("computed: " + (error instanceof TypeError));
    }
  }
}

function show(object: Base): string {
  return Object.keys(object).join(",") + " | " + object.stored + " " + object.both + " " + object.computed;
}

for (let i = 1; i <= 3; i++) console.log(show(new Derived(i)));
console.log(events.join("\n"));
