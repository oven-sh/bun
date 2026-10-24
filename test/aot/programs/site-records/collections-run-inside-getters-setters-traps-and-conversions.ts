// The general way of a read, a store or a call runs code of the program: a getter, a setter, a trap, a conversion. That code drops objects, runs a full collection and makes new structures before it returns. What the operation holds on to survives, and what it remembers afterwards is true.
interface Sample {
  value: unknown;
  other: unknown;
  act?: () => unknown;
}

function churn(mark: string): void {
  const dropped: object[] = [];
  for (let i = 0; i < 50; i++) dropped.push({ ["churn " + mark + i]: i, value: "wrong", other: "wrong" });
  dropped.length = 0;
  Bun.gc(true);
  for (let i = 0; i < 50; i++) dropped.push({ ["after " + mark + i]: i, pad: 0, other: "wrong", value: "wrong" });
}
function fresh(text: string): { text: string } {
  return { text: text + "!" };
}

function valueOf(sample: Sample): unknown {
  return sample.value;
}
function otherOf(sample: Sample): unknown {
  return sample.other;
}
function setValue(sample: Sample, value: unknown): void {
  sample.value = value;
}
function act(sample: Sample): unknown {
  return sample.act!();
}
function look(mark: string, make: () => Sample): void {
  const sample = make();
  const parts = [valueOf(sample), valueOf(sample), otherOf(sample)];
  setValue(sample, fresh("stored"));
  parts.push(valueOf(sample), otherOf(sample), sample.act ? act(sample) : "no act", valueOf(make()), otherOf(make()));
  console.log(mark + ":", JSON.stringify(parts));
}

let round = 0;

look("honest", () => ({ value: fresh("value"), other: fresh("other") }));
look("a getter collects", () => ({
  get value() {
    churn("g" + round++);
    return fresh("from the getter");
  },
  set value(_value: unknown) {},
  other: fresh("other"),
}));
look("a setter collects", () => {
  let held: unknown = fresh("held");
  return {
    get value() {
      return held;
    },
    set value(value: unknown) {
      churn("s" + round++);
      held = value;
    },
    other: fresh("other"),
  };
});
look("a getter collects and replaces itself", () => ({
  get value() {
    churn("r" + round++);
    Object.defineProperty(this, "value", { value: fresh("replaced"), writable: true, enumerable: true, configurable: true });
    return fresh("first read");
  },
  other: fresh("other"),
}));
look("a getter collects and changes the layout", () => ({
  get value() {
    delete (this as any).other;
    churn("l" + round++);
    (this as any)["late" + round] = 1;
    (this as any).other = fresh("other, moved");
    return fresh("from the getter");
  },
  set value(_value: unknown) {},
  other: fresh("other"),
}));
look("traps collect", () =>
  new Proxy<Sample>(
    { value: fresh("target value"), other: fresh("target other") },
    {
      get(target, key, receiver) {
        churn("t" + round++);
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        churn("u" + round++);
        return Reflect.set(target, key, value, receiver);
      },
    },
  ),
);
look("a getter on the chain collects", () =>
  Object.create({
    get value() {
      churn("c" + round++);
      return fresh("from above");
    },
    set value(value: unknown) {
      churn("d" + round++);
      Object.defineProperty(this, "value", { value, writable: true, enumerable: true, configurable: true });
    },
    other: fresh("other above"),
  }),
);
look("the method collects and drops its receiver's fields", () => ({
  value: fresh("value"),
  other: fresh("other"),
  act() {
    const before = this.value;
    delete (this as any).value;
    churn("m" + round++);
    return [before, this.other];
  },
}));
look("a getter hands out a method and collects", () => ({
  value: fresh("value"),
  other: fresh("other"),
  get act() {
    const text = fresh("captured");
    churn("a" + round++);
    return () => text;
  },
}));
look("parsed objects between collections", () => {
  const parsed = JSON.parse('{"x' + round++ + '":0,"other":{"text":"parsed other"},"value":{"text":"parsed value"}}');
  Bun.gc(true);
  return parsed;
});
look("honest", () => ({ value: fresh("value"), other: fresh("other") }));

const key = {
  toString() {
    churn("k" + round++);
    return "value";
  },
};
const byKey: Sample = { value: fresh("by a key that collects"), other: 0 };
console.log(JSON.stringify((byKey as any)[key as any]), JSON.stringify({ [key as any]: fresh("literal"), other: fresh("beside") }));

export {};
