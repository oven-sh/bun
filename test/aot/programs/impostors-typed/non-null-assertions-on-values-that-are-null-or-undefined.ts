function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

interface Link {
  value: number;
  next?: Link;
  label: string | null;
}

function valueOfNext(n: Link): number {
  return n.next!.value + 1;
}

function labelLength(n: Link): number {
  return n.label!.length;
}

function firstOf(list: number[]): number {
  return list[0]! * 2;
}

function found(list: number[], wanted: number): number {
  return list.find(value => value === wanted)! + 1;
}

function fromMap(m: Map<string, number>, key: string): number {
  return m.get(key)! + 1;
}

function matched(text: string): number {
  return /(\d+)/.exec(text)![1]!.length;
}

function maybe(n: number | undefined): number {
  return n! + 1;
}

function maybeNull(s: string | null): string {
  return s! + "!";
}

function called(f: (() => number) | undefined): number {
  return f!() + 1;
}

class Late {
  size!: number;
  name!: string;
  items!: number[];
  grow(): number {
    return this.size + 1;
  }
  shout(): string {
    return this.name + "!";
  }
  count(): number {
    return this.items.length;
  }
}

function honest(label: string): void {
  const tail: Link = { value: 2, label: "tail" };
  const head: Link = { value: 1, next: tail, label: "head" };
  const late = new Late();
  late.size = 1;
  late.name = "late";
  late.items = [1];
  console.log(label, valueOfNext(head), labelLength(head), firstOf([4]), found([1, 2], 2), fromMap(new Map([["a", 1]]), "a"), matched("a12"), maybe(1), maybeNull("s"), called(() => 1), late.grow(), late.shout(), late.count());
}

honest("honest before");
let warm = 0;
const tail: Link = { value: 2, label: "tail" };
const head: Link = { value: 1, next: tail, label: "head" };
const filled = new Map([["a", 1]]);
for (let i = 0; i < 2000; i++) warm += valueOfNext(head) + labelLength(head) + firstOf([i]) + found([i], i) + fromMap(filled, "a") + matched("a1") + maybe(i) + called(() => i);
console.log("2000 honest rounds", warm);

attempt("next is absent", () => valueOfNext(tail));
attempt("next is undefined", () => valueOfNext({ value: 1, next: undefined, label: null }));
attempt("label is null", () => labelLength({ value: 1, label: null }));
attempt("an empty list", () => firstOf([]));
attempt("a hole", () => firstOf(new Array<number>(2)));
attempt("nothing found", () => found([1, 2], 3));
attempt("no such key", () => fromMap(filled, "b"));
attempt("no match", () => matched("abc"));
attempt("undefined", () => maybe(undefined));
attempt("null", () => maybeNull(null));
attempt("no function", () => called(undefined));
attempt("fields never set: grow", () => new Late().grow());
attempt("fields never set: shout", () => new Late().shout());
attempt("fields never set: count", () => new Late().count());
attempt("fields never set: keys", () => Object.keys(new Late()).join() + "|" + ("size" in new Late()));
attempt("a chain of assertions", () => head.next!.next!.next!.value);
attempt("an assertion on a store target", () => {
  const n: Link = { value: 1, label: null };
  n.next!.value = 5;
  return n.value;
});
attempt("an assertion kept in a typed local", () => {
  const n: number = [1, 2].find(v => v > 5)!;
  const doubled: number = n * 2;
  return [n, doubled];
});
attempt("an assertion kept in a typed field", () => {
  const late = new Late();
  late.size = [1, 2].find(v => v > 5)!;
  return [late.size, late.grow()];
});
attempt("an assertion kept in a typed array", () => {
  const list: number[] = [1, [1, 2].find(v => v > 5)!, 3];
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return [sum, list];
});
attempt("an assertion and then a default", () => (filled.get("b")! ?? 7) + 1);
attempt("an assertion and then an optional chain", () => tail.next!?.value);
attempt("an assertion on a value from any", () => maybe(hidden("'text'")!));

honest("honest after");
