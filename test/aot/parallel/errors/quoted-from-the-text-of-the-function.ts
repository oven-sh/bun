// A TypeError quotes the read or the call that failed as the function spells it, where the executable holds the text of the function: it does for a function that
// is handed on as a value, which these are by being exported.
const thrown = (run: () => unknown): string => {
  try {
    run();
    return "nothing thrown";
  } catch (error) {
    return String(error);
  }
};
const none = null as any;
const missing = undefined as any;
const api = {} as any;
const make = (name: string) => ({ name }) as any;

export function expand(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, "x");
}
export function length(value: { list: number[] }): number {
  return value.list.length;
}
export class Holder {
  inner: { deep: { name: string } } | null = null;
  read(): string {
    return this.inner!.deep.name;
  }
  static make(options: { size: number } | undefined): number {
    const doubled = options!.size * 2;
    return doubled;
  }
}
export function twice(first: { a: number }, second: { a: number }) {
  return first.a + first.a + (second ? 1 : 0);
}
export function optional(value: { a?: { b: { c: number } } }) {
  return value.a?.b.c;
}
export function ofACall(give: () => { a: number }) {
  return give().a;
}
export function ofAnElement(list: { a: number }[]) {
  return list[0].a;
}
export function spread(value: { list: number[] }) {
  return [...value.list.slice(1)];
}
export function typesOverLines(
  value: {
    list: number[];
  },
  other: number,
): number {
  const sum = other + 1;
  return value.list.length + sum;
}
console.log(thrown(() => expand(none)));
console.log(thrown(() => expand(missing)));
console.log(thrown(() => length(none)));
console.log(thrown(() => length({} as any)));
console.log(thrown(() => new Holder().read()));
console.log(
  thrown(() => {
    const holder = new Holder();
    holder.inner = {} as any;
    return holder.read();
  }),
);
console.log(thrown(() => Holder.make(missing)));
console.log(thrown(() => twice(none, none)));
console.log(thrown(() => optional({ a: {} as any })));
console.log(thrown(() => ofACall(() => none)));
console.log(thrown(() => ofAnElement([none])));
console.log(thrown(() => spread(none)));
console.log(thrown(() => spread({} as any)));
console.log(thrown(() => typesOverLines(none, 1)));
console.log(thrown(() => typesOverLines({} as any, 1)));

export const calls = [
  () => api.fetchUser("ARGUMENT"),
  () => api.fetchUser("alice", { token: "ARGUMENT" }),
  () => api.fetchUser(),
  () => make("ARGUMENT").run(),
  () => api.fetchUser(...["ARGUMENT"]),
  () => api.fetchUser("a ) in a text"),
  () => api.fetchUser(make("x"), [1, 2]),
  () => new api.Missing("ARGUMENT"),
  () => new api.Missing(),
  () => api.fetchUser!("typed" as string),
];
for (const call of calls) console.log(thrown(call));
export function sameTwice(flag: boolean) {
  if (flag) return api.first("a");
  return api.first("a");
}
console.log(thrown(() => sameTwice(false)));
export function onTwoLines() {
  api.first("a");
  api.first("b");
}
console.log(thrown(onTwoLines));

// Round brackets in front of a path go with the type in them, and stay where the meaning hangs on them.
type Anything = any;
export const castCall = (typed: {}) => {
  (typed as any).other("ARGUMENT");
};
console.log(thrown(() => castCall({})));
export const castRead = (typed: {}) => {
  const read = (typed as any).inner.value;
  return read;
};
console.log(thrown(() => castRead({})));
export const castOfPath = (holder: { typed: {} }) => {
  (holder.typed as any).other("ARGUMENT");
};
console.log(thrown(() => castOfPath({ typed: {} })));
export const castOfNull = () => {
  const read = (null as any).member;
  return read;
};
console.log(thrown(castOfNull));
export const castOfCall = (make: () => {}) => {
  const read = (make() as any).inner.value;
  return read;
};
console.log(thrown(() => castOfCall(() => ({}))));
// prettier-ignore
export const castTwice = (typed: {}) => { ((typed as unknown) as Anything).other(1); };
console.log(thrown(() => castTwice({})));
export const satisfied = (typed: any) => {
  (typed satisfies Anything).other(1);
};
console.log(thrown(() => satisfied({})));
// prettier-ignore
export const marked = (typed: any) => { (typed!).other(1); };
console.log(thrown(() => marked({})));
// prettier-ignore
export const onlyBrackets = (typed: any) => { (typed).other(1); };
console.log(thrown(() => onlyBrackets({})));
export const castOfGeneric = (typed: {}) => {
  (typed as Record<string, (n: number) => void>).other(1);
};
console.log(thrown(() => castOfGeneric({})));
export const castInArgument = (typed: any, x: {}) => {
  typed.other((x as any).y, [x as any], { k: x as Anything });
};
console.log(thrown(() => castInArgument({}, {})));
export const castConstruct = (space: {}) => {
  const made = new (space as any).Missing("ARGUMENT");
  return made;
};
console.log(thrown(() => castConstruct({})));
export const sum = (a: any, b: any) => {
  const read = (a + b).inner.value;
  return read;
};
console.log(thrown(() => sum(1, 2)));
export const either = (a: any, b: any) => {
  (a || b).other(1);
};
console.log(thrown(() => either(0, {})));
export const conditional = (a: any, b: any) => {
  (a ? a : b).other(1);
};
console.log(thrown(() => conditional(0, {})));
export const optionalInBrackets = (a: any) => {
  const read = (a?.b).inner.value;
  return read;
};
console.log(thrown(() => optionalInBrackets({ b: {} })));
// prettier-ignore
export const calledTwice = (f: any) => { (f)(1).other(2); };
console.log(thrown(() => calledTwice(() => ({}))));
export const arrowArgument = (typed: any) => {
  typed.other((x: any) => x.y, 2);
};
console.log(thrown(() => arrowArgument({})));
// An element is quoted with its key as it is written, and a store with its value. The key is one that only the run knows.
const known = (text: string) => (process.argv.length > 99 ? "" : text);
export const element = (o: any, k: string) => {
  const read = o.inner[k];
  return read;
};
console.log(thrown(() => element({}, known("name"))));
console.log(thrown(() => element({}, known("other"))));
export const index = (o: any) => {
  const read = o[0];
  return read;
};
console.log(thrown(() => index(none)));
export const computedKey = (o: {}, k: string) => {
  const read = (o as any).inner[k + "x"];
  return read;
};
console.log(thrown(() => computedKey({}, known("name"))));
export function storeOfSum(this: any, v: number) {
  this.state.count = v + 1;
}
console.log(thrown(() => storeOfSum.call({}, 1)));
export const storeOfObject = (o: any) => {
  o.inner.x = { a: 1, b: [2] };
};
console.log(thrown(() => storeOfObject({})));
export const storeOfElement = (o: any, k: string) => {
  o[k] = 1;
};
console.log(thrown(() => storeOfElement(none, known("name"))));
export const storeInBrackets = (o: any) => {
  const stored = (o.x = 1);
  return stored;
};
console.log(thrown(() => storeInBrackets(none)));
export const addTo = (o: any) => {
  o.x += 1;
};
console.log(thrown(() => addTo(none)));
// A chain and the arguments of a call are printed on one line. What stands in curly brackets keeps its lines.
export function chainRead(config: any) {
  // prettier-ignore
  const value = config
    .get("a")
    .inner.value;
  return value;
}
export function chainCall(builder: any) {
  // prettier-ignore
  builder
    .first()
    // it's a comment between
    .second("x")
    .third();
}
export function callOverLines(api: any, one: number, two: string) {
  // prettier-ignore
  api.fetchUser(
    one,
    'two',
    two,
  );
}
export function callOfObject(api: any) {
  api.fetchUser({
    name: "a name that is long enough to keep the object on several lines",
    more: [1, 2, "and a text that is long enough to do the same for this one"],
  });
}
export function readBehindCallOverLines(api: any) {
  // prettier-ignore
  const value = api.get(
    "a",
    "b",
  ).inner.value;
  return value;
}
export function constructOverLines(space: any) {
  // prettier-ignore
  const made = new space.Missing(
    "a",
    "b",
  );
  return made;
}
export function storeOverLines(o: any, long: number) {
  // prettier-ignore
  o.inner.value =
    long + 1;
}
export function castOverLines(config: any) {
  // prettier-ignore
  const value = (
    config.get("a") as any
  ).inner.value;
  return value;
}
console.log(thrown(() => chainRead({ get: () => ({}) })));
console.log(thrown(() => chainCall({ first: () => ({ second: () => ({}) }) })));
console.log(thrown(() => callOverLines({}, 1, "2")));
console.log(thrown(() => callOfObject({})));
console.log(thrown(() => readBehindCallOverLines({ get: () => ({}) })));
console.log(thrown(() => constructOverLines({})));
console.log(thrown(() => storeOverLines({}, 1)));
console.log(thrown(() => castOverLines({ get: () => ({}) })));
// A private name that the object lacks.
class Box {
  #held = 1;
  #method() {}
  static read(o: any) {
    const read = o.#held;
    return read;
  }
  static write(o: any) {
    o.#held = 2;
  }
  static call(o: any) {
    o.#method();
  }
}
console.log(thrown(() => Box.read({})));
console.log(thrown(() => Box.write({})));
console.log(thrown(() => Box.call({})));
// A text with nothing to escape is printed in double quotes.
// prettier-ignore
export const marks = (typed: any) => { typed.other('single', `template`, "double", 'with "double" in it'); };
console.log(thrown(() => marks({})));

// `in`, `delete`, a symbol for a key, and a call on what `new` made.
export const hasKey = (value: any) => "a" in value;
console.log(thrown(() => hasKey(none)));
console.log(thrown(() => hasKey(5)));
export const hasKeyOfPath = (holder: { inner: any }, key: string) => [key in holder.inner, key];
console.log(thrown(() => hasKeyOfPath({ inner: missing }, "a")));
export function hasKeyBesideWalk(value: any, other: any) {
  for (const key in value) if (key in other) return key;
}
console.log(thrown(() => hasKeyBesideWalk({ a: 1 }, none)));
export function remove(value: any) {
  delete value.a;
}
console.log(thrown(() => remove(none)));
export const removeElement = (value: any, key: string) => [delete value[key], key];
console.log(thrown(() => removeElement(missing, "a")));
export const readSymbol = (value: any) => value[Symbol.iterator];
console.log(thrown(() => readSymbol(none)));
export class Made {
  speak() {
    return "made";
  }
}
export const callOnConstructed = () => {
  (new Made() as any).missing("ARGUMENT");
};
console.log(thrown(callOnConstructed));
export const readOnConstructed = () => (new Made() as any).missing.deeper;
console.log(thrown(readOnConstructed));
export class Heir extends (null as any) {
  constructor(value: number) {
    super(value);
  }
}
console.log(thrown(() => new Heir(1)));
export class HeirWithoutConstructor extends (null as any) {}
console.log(thrown(() => new HeirWithoutConstructor()));

// Where the text does not say which place failed, or spells it otherwise than Bun's transpiler prints it, only what stands in front of the quote is the same.
const start = (run: () => unknown) => thrown(run).split(" (")[0];
export const two = (first: { a: number }, second: { a: number }) => first.a + second.a;
console.log(start(() => two(none, { a: 1 })));
console.log(start(() => two({ a: 1 }, none)));
export function store(target: { x: number }) {
  target.x = 1;
}
console.log(start(() => store(none)));
export function overLines() {
  return api.fetchUser("ARGUMENT", 2);
}
console.log(start(overLines));
const name = "a name";
export const named = () => api.fetchUser(name);
console.log(start(named));
export const otherOnTheLine = (typed: {}, x: any) => [x.other(1), (typed as any).other(2)];
console.log(start(() => otherOnTheLine({}, { other() {} })));
export const constructOfCall = (make: () => any) => {
  const made = new (make().Missing)(1);
  return made;
};
console.log(start(() => constructOfCall(() => ({}))));
