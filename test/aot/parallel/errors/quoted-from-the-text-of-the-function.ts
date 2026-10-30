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
  return api.fetchUser(
    "ARGUMENT",
    2,
  );
}
console.log(start(overLines));
const name = "a name";
export const named = () => api.fetchUser(name);
console.log(start(named));
