// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) where the type of the result names every property, so the target has a place for each,
// and some of them are accessors, hidden or read-only: the order of the keys, the descriptors, and what later stores, definitions and deletions meet.
const lines: string[] = [];
const say = (...words: unknown[]) => lines.push(words.map(String).join(" "));
const describe = (object: object, key: PropertyKey) => {
  const found = Object.getOwnPropertyDescriptor(object, key);
  if (!found) return "none";
  return "value" in found
    ? `value ${typeof found.value === "function" ? "function" : String(found.value)} ${found.writable} ${found.enumerable} ${found.configurable}`
    : `accessor ${typeof found.get} ${typeof found.set} ${found.enumerable} ${found.configurable}`;
};
const whole = (object: object) => Reflect.ownKeys(object).map(key => `${String(key)}: ${describe(object, key)}`).join(" | ");

const defaults = { enabled: () => true, hidden: () => false, order: 0 };
type Definition = {
  name: string;
  title?: string;
  limit?: number;
  input?: number;
  output?: string;
  secret?: number;
  fixed?: string;
  run?(): number;
  stop?(): number;
  order?: number;
  enabled?(): boolean;
  tail0?: number;
  tail1?: number;
  tail2?: number;
};
type Whole = Finished<Definition>;
type Finished<T> = T & typeof defaults & { label(): string; a(): string; b(): number };
function finish<T extends Definition>(definition: T): Finished<T> {
  const methods = { a: () => definition.name, b: () => 0 };
  return Object.assign(Object.defineProperties({ ...defaults, label: () => definition.name }, Object.getOwnPropertyDescriptors(definition)), methods) as unknown as Finished<T>;
}

let stored = "";
const first: Whole = finish({
  name: "first",
  title: "t",
  get input() {
    return 1;
  },
  limit: 2,
  get output() {
    return "out" + stored;
  },
  set output(value: string) {
    stored = value;
  },
  run() {
    return 3;
  },
  tail0: 4,
});
say("first", whole(first));
say("first reads", first.input, first.output, first.limit, first.run!(), first.label(), first.a(), first.enabled());
first.output = "!";
say("first after its setter", first.output, stored, JSON.stringify(first), Object.keys(first).join());
first.tail1 = 5;
first.limit = 6;
say("first after stores", whole(first));
delete first.title;
delete first.input;
first.title = "again";
say("first after deletions", whole(first));
Object.defineProperty(first, "input", { value: 7, writable: true, enumerable: true, configurable: true });
say("first with a value again", whole(first), first.input);

const accessorFirst: Whole = finish({
  get input() {
    return 10;
  },
  name: "accessorFirst",
  stop() {
    return 0;
  },
});
const accessorLast: Whole = finish({
  name: "accessorLast",
  tail2: 1,
  tail0: 2,
  get input() {
    return 11;
  },
});
say("an accessor first", whole(accessorFirst), accessorFirst.input);
say("an accessor last", whole(accessorLast), accessorLast.input);

const source: Definition = { name: "attributes", title: "t" };
Object.defineProperty(source, "secret", { value: 1, enumerable: false, writable: true, configurable: true });
source.limit = 2;
Object.defineProperty(source, "fixed", { value: "f", enumerable: true, writable: false, configurable: false });
source.tail0 = 3;
const withAttributes: Whole = finish(source);
say("attributes", whole(withAttributes), Object.keys(withAttributes).join());
try {
  withAttributes.fixed = "g";
  say("the store to fixed passed");
} catch (error) {
  say("the store to fixed threw", (error as Error).constructor.name);
}
withAttributes.secret = 4;
say("attributes after stores", describe(withAttributes, "secret"), describe(withAttributes, "fixed"));

const overDefaults: Whole = finish({
  name: "overDefaults",
  get order() {
    return 12;
  },
  enabled() {
    return false;
  },
  get limit() {
    return 13;
  },
});
say("over what the target had", whole(overDefaults), overDefaults.order, overDefaults.enabled(), overDefaults.limit);

const shared = {
  name: "shared",
  get input() {
    return 14;
  },
};
const one: Whole = finish(shared);
const other: Whole = finish(shared);
const getterOf = (object: object) => Object.getOwnPropertyDescriptor(object, "input")!.get;
say("two targets of one source", getterOf(one) === getterOf(other), getterOf(one) === getterOf(shared), whole(one) === whole(other));
Object.defineProperty(one, "input", { get: () => 15 });
say("one of them redefined", one.input, other.input, shared.input);

const many: string[] = [];
for (let index = 0; index < 24; index++) {
  const made: Whole =
    index % 3 === 0
      ? finish({ name: "n" + index, get input() { return index; }, limit: index, tail0: 1 })
      : index % 3 === 1
        ? finish({ name: "n" + index, limit: index, get input() { return index; }, get output() { return "o"; }, tail1: 1 })
        : finish({ name: "n" + index, tail2: 2, limit: index });
  many.push(`${Object.keys(made).join()}=${made.input}`);
}
say("many", [...new Set(many.map(text => text.replace(/=.*/, "")))].join(" / "), many.map(text => text.replace(/.*=/, "")).join());

const sealed = Object.seal({ ...defaults, label: () => "" }) as unknown as Finished<Definition>;
try {
  Object.defineProperties(sealed, Object.getOwnPropertyDescriptors({ name: "sealed", get input() { return 1; } }));
  say("the sealed target took them");
} catch (error) {
  say("the sealed target threw", (error as Error).constructor.name, whole(sealed));
}

console.log(lines.join("\n"));
