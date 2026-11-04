// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: churn soon Pair join
// CHECK-LABEL: function {{*}}name="churn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Negate v0
// CHECK-NEXT: v2 = NewObject -, v0, v1 layout=[[L_1]] fields=[0, 1]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v0, v4
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = NewArray v0, v5, v7 contents=anything
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = Greater v0, v9
// CHECK-NEXT: Branch v10 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Sub v0, v12
// CHECK-NEXT: v14 = Call v11, -, v13 calleeName="churn"
// CHECK-NEXT: v15 = CallDirect v3, v8 function=[[f_3]]
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="Bun" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="gc"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(BunGc) flags=[IsExpected]}
// CHECK-NEXT: v23 = Boolean boolean=true
// CHECK-NEXT: v24 = Call v22, v20, v23 calleeKey="gc" calleeName="Bun.gc"
// CHECK-NEXT: v25 = CallDirect v3, v8 function=[[f_3]]
// CHECK-NEXT: ReturnCall v25 casts=[{declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="soon"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Promise" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="resolve"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v0 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Pair"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_4]], v2: undefined|null|string):
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: PropSet v5, v1 key="a"
// CHECK-NEXT: PropSet v5, v2 key="b"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b1(| 0), notTaken b2(v5)
// CHECK-NEXT: b1(v11):
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="join"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = Call v2, -, v0, v1 calleeName="use"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
