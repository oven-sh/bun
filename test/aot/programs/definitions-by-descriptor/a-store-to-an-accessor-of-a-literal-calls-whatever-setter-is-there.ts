// A literal with `get` and `set` under one name, stored to again and again, while the program changes what lies under the name.
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.join(" "));
const attempt = (name: string, action: () => unknown) => {
  try {
    say(name, action());
  } catch (error) {
    say(name, (error as Error).constructor.name, (error as Error).message);
  }
};

function make(start: number) {
  return {
    held: start,
    calls: 0,
    get value(): number {
      return this.held;
    },
    set value(next: number) {
      this.calls++;
      this.held = next * 2;
    },
  };
}
type Made = ReturnType<typeof make>;

function store(object: Made, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) {
    object.value = i & 7;
    sum += object.value;
  }
  return sum;
}

const plain = make(1);
say("as written", store(plain, 100), plain.calls, plain.held);
say("the value of the assignment", (plain.value = 21), plain.held);
plain.value += 1;
say("compound", plain.held);
plain.value++;
say("increment", plain.held, plain.calls);

// Another setter, the same getter.
const other = make(2);
Object.defineProperty(other, "value", {
  set(this: Made, next: number) {
    this.held = next + 1000;
  },
});
say("another setter", store(other, 100), other.calls, other.held);

// A setter that is no function of the program.
const bound = make(3);
const target = { seen: 0 };
Object.defineProperty(bound, "value", {
  set: function (this: typeof target, next: number) {
    this.seen += next;
  }.bind(target),
});
say("a bound setter", store(bound, 100), bound.calls, target.seen);

const native = make(4);
const list: number[] = [];
Object.defineProperty(native, "value", { set: Array.prototype.push.bind(list) });
say("a setter of the engine", store(native, 10), list.join());

const trapped = make(5);
const applied: string[] = [];
Object.defineProperty(trapped, "value", {
  set: new Proxy(function () {}, {
    apply(_target, receiver, args) {
      applied.push(`${receiver === trapped}:${args.length}:${args[0]}`);
    },
  }),
});
say("a proxy", store(trapped, 3), applied.join());

// No setter any more.
const without = make(6);
Object.defineProperty(without, "value", { set: undefined });
attempt("no setter", () => store(without, 100));
say("no setter left", without.calls, without.held, typeof Object.getOwnPropertyDescriptor(without, "value")!.get);

// No accessor any more.
const deleted = make(7);
delete (deleted as Partial<Made>).value;
say("deleted", store(deleted, 100), deleted.calls, deleted.held, JSON.stringify(Object.getOwnPropertyDescriptor(deleted, "value")));

const data = make(8);
Object.defineProperty(data, "value", { value: 5, writable: true });
say("a value", store(data, 100), data.calls, JSON.stringify(Object.getOwnPropertyDescriptor(data, "value")));

const fixed = make(9);
Object.defineProperty(fixed, "value", { value: 5, writable: false });
attempt("a value nobody writes", () => store(fixed, 100));

// Integrity levels leave an accessor what it is.
const frozen = Object.freeze(make(10));
attempt("frozen", () => store(frozen, 100));
say("frozen", frozen.calls, frozen.held);
const sealed = Object.seal(make(11));
say("sealed", store(sealed, 100), sealed.calls, sealed.held);

// The setter changes what lies under its own name.
const lazy = {
  computed: 0,
  get value(): number {
    return -1;
  },
  set value(next: number) {
    this.computed++;
    Object.defineProperty(this, "value", { value: next, writable: true, configurable: true, enumerable: true });
  },
};
let lazySum = 0;
for (let i = 0; i < 50; i++) {
  lazy.value = i;
  lazySum += lazy.value;
}
say("a setter that replaces itself", lazySum, lazy.computed);

// The setter throws.
const refusing = {
  accepted: 0,
  get value(): number {
    return this.accepted;
  },
  set value(next: number) {
    if (next > 3) throw new RangeError(`too much: ${next}`);
    this.accepted = next;
  },
};
attempt("a setter that throws", () => {
  for (let i = 0; i < 10; i++) refusing.value = i;
});
say("accepted", refusing.accepted);

// From below, the receiver is the heir.
const heir: Made = Object.create(make(12));
say("an heir", store(heir, 100), Object.keys(heir).join(), heir.calls, Object.getPrototypeOf(heir).calls);

// What the setter is given.
const counting = {
  given: "",
  get value(): number {
    return 0;
  },
  set value(next: number) {
    this.given = `${arguments.length}:${next}:${this === counting}`;
  },
};
counting.value = 4;
say("arguments", counting.given);

// Two literals of one shape with setters of their own.
function either(first: boolean) {
  return first
    ? {
        held: 0,
        get value(): number {
          return this.held;
        },
        set value(next: number) {
          this.held = next + 1;
        },
      }
    : {
        held: 0,
        get value(): number {
          return this.held;
        },
        set value(next: number) {
          this.held = next - 1;
        },
      };
}
let eitherSum = 0;
for (let i = 0; i < 100; i++) {
  const object = either((i & 1) === 0);
  object.value = i;
  eitherSum += object.value;
}
say("two literals", eitherSum);

// One of the shape has the getter alone.
function maybeSettable(settable: boolean): { held: number; value: number } {
  if (settable)
    return {
      held: 0,
      get value(): number {
        return this.held;
      },
      set value(next: number) {
        this.held = next;
      },
    };
  return {
    held: 7,
    get value(): number {
      return this.held;
    },
  } as { held: number; value: number };
}
function storeInto(object: { held: number; value: number }) {
  object.value = 3;
  return object.value;
}
for (let i = 0; i < 20; i++) storeInto(maybeSettable(true));
attempt("the getter alone", () => storeInto(maybeSettable(false)));

// Object.defineProperty with both halves.
const defined: { value: number; inner: number } = Object.defineProperty({ inner: 3 } as any, "value", {
  get(this: any) {
    return this.inner;
  },
  set(this: any, next: number) {
    this.inner = next * 3;
  },
});
let definedSum = 0;
for (let i = 0; i < 100; i++) {
  defined.value = i & 3;
  definedSum += defined.value;
}
say("defined", definedSum, Object.keys(defined).join(), JSON.stringify(Object.getOwnPropertyDescriptor(defined, "value")));

// An accessor that each instance gets in its constructor.
class Cell {
  inner = 0;
  declare value: number;
  constructor(step: number) {
    Object.defineProperty(this, "value", {
      get: () => this.inner,
      set: (next: number) => {
        this.inner = next + step;
      },
      enumerable: true,
      configurable: true,
    });
  }
}
const cells = [new Cell(1), new Cell(10)];
let cellSum = 0;
for (let i = 0; i < 100; i++) {
  const cell = cells[i & 1]!;
  cell.value = i;
  cellSum += cell.value;
}
say("in the constructor", cellSum);

// The store stands in front of the definition.
const late: { value?: number; held: number } = { held: 0 };
late.value = 1;
say("before", JSON.stringify(late));
Object.defineProperty(late, "value", {
  get(this: { held: number }) {
    return this.held;
  },
  set(this: { held: number }, next: number) {
    this.held = next + 5;
  },
  configurable: true,
  enumerable: true,
});
late.value = 1;
say("behind", JSON.stringify(late));

console.log(lines.join("\n"));
