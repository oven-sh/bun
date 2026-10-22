// `use({ tag }, await later())`: the first operand is made, then the function gives up its frame, then the call happens. An object, a closure, an array or a fresh result that was made "for the one call" waits through the suspension: in an argument list, a literal, a template, an operator, a `new`, a chain of calls; over `await` and over `yield`.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface T {
  tag: string;
}
function later<X>(x: X): Promise<X> {
  return new Promise(resolve => setTimeout(resolve, 0, x));
}
function soon<X>(x: X): Promise<X> {
  return Promise.resolve(x);
}
function make(tag: string): T {
  return { tag };
}
function use(a: T, b: string): string {
  return a.tag + "+" + b;
}
function useThree(a: T, b: string, c: T): string {
  return a.tag + "+" + b + "+" + c.tag;
}
function callBoth(f: () => string, b: string): string {
  return f() + "+" + b;
}
class Pair {
  constructor(
    public a: T,
    public b: string,
  ) {}
}
const forms: [string, (i: number) => Promise<string>][] = [
  ["argument", async i => use({ tag: "literal " + i }, await later("b"))],
  ["fresh result as argument", async i => use(make("made " + i), await later("b"))],
  ["between two", async i => useThree({ tag: "first " + i }, await later("b"), { tag: "third " + i })],
  ["closure as argument", async i => {
    const state = { tag: "state " + i };
    return callBoth(() => state.tag, await later("b"));
  }],
  ["two awaits", async i => useThree({ tag: "first " + i }, await soon("b"), await later({ tag: "awaited " + i }))],
  ["object literal", async i => {
    const o = { a: { tag: "member " + i }, b: await later("b") };
    return use(o.a, o.b);
  }],
  ["array literal", async i => {
    const l = [{ tag: "element " + i }, await later({ tag: "b" })];
    return use(l[0], l[1].tag);
  }],
  ["template", async i => `${make("templated " + i).tag}+${await later("b")}`],
  ["operator", async i => make("left " + i).tag + "+" + (await later("b"))],
  ["new", async i => {
    const p = new Pair({ tag: "constructed " + i }, await later("b"));
    return use(p.a, p.b);
  }],
  ["receiver", async i => ({ tag: "receiver " + i, join(b: string) { return use(this, b); } }).join(await later("b"))],
  ["callee", async i => ((b: string) => "callee " + i + "+" + b)(await later("b"))],
  ["spread", async i => use(...([{ tag: "spread " + i }, await later("b")] as [T, string]))],
  ["computed key", async i => {
    const o = { first: { tag: "before the key " + i }, [await later("key")]: "b" } as { first: T; key: string };
    return use(o.first, o.key);
  }],
  ["store target", async i => {
    const holder: { t: T; s?: string } = { t: { tag: "holder " + i } };
    holder.s = await later("b");
    return use(holder.t, holder.s);
  }],
  ["element store", async i => {
    const list: (T | string)[] = [{ tag: "list " + i }];
    list[list.length] = await later("b");
    return use(list[0] as T, list[1] as string);
  }],
  ["conditional", async i => use({ tag: "conditional " + i }, (await later(true)) ? "b" : "c")],
  ["nested calls", async i => use(make(use({ tag: "inner " + i }, await soon("x"))), await later("b"))],
  ["default parameter", async i => (async (a: T = { tag: "default " + i }, b: string = "?") => use(a, b))(undefined, await later("b"))],
  ["return of a pair", async i => {
    const [a, b] = [make("pair " + i), await later("b")];
    return use(a, b);
  }],
  ["for await head", async i => {
    const head = { tag: "head " + i };
    let out = "";
    for await (const b of [later("b")]) out = use(head, b);
    return out;
  }],
  ["try and finally", async i => {
    const t = { tag: "tried " + i };
    try {
      return use(t, await later("b"));
    } finally {
      t.tag = "too late";
    }
  }],
  ["rejected", async i => {
    try {
      return use({ tag: "never used " + i }, await Promise.reject(new Error("rejected")));
    } catch (e) {
      return use({ tag: "caught " + i }, (e as Error).message);
    }
  }],
];
const pending: Promise<string>[] = [];
for (let i = 0; i < 25; i++) for (const [, form] of forms) pending.push(form(i));
churn(80);
await soon(0);
churn(80);
const answers = await Promise.all(pending);
console.log(answers.slice(-forms.length).join("\n"));
console.log(answers.slice(0, forms.length).every((a, k) => a.replace(/ 0\b/g, " 24") === answers[answers.length - forms.length + k]));

// The same over `yield`.
function* yielding(i: number): Generator<string, string, string> {
  const a = use({ tag: "literal " + i }, yield "one");
  const b = useThree(make("made " + i), yield "two", { tag: "third " + i });
  const state = { tag: "state " + i };
  const c = callBoth(() => state.tag, yield "three");
  const d = [{ tag: "element " + i }, yield "four"] as [T, string];
  const e = new Pair({ tag: "constructed " + i }, yield "five");
  return [a, b, c, use(d[0], d[1]), use(e.a, e.b)].join(" | ");
}
const generators = Array.from({ length: 30 }, (_, i) => yielding(i));
for (const g of generators) g.next();
for (const sent of ["v", "w", "x", "y"]) {
  churn(60);
  for (const g of generators) g.next(sent);
}
churn(60);
const last = generators.map(g => g.next("z").value);
console.log(last[0]);
console.log(last[29]);
