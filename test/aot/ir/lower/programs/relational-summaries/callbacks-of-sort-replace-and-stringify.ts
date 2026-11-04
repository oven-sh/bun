// RUN: lower
// OPTIONS: builtin-modules

// Built-ins that take a callback do not keep the callback, but they choose what it is called with, how often, in which order and with which `this`; the callback keeps its operands, changes the collection under the built-in, throws out of it, or is called again from inside itself.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Row {
  rank: number;
  tag: string;
}
const row = (rank: number, tag = "row" + rank): Row => ({ rank, tag });
const kept: unknown[] = [];
const tags = (list: unknown[]) => list.map(k => (typeof k === "object" && k !== null && "tag" in k ? (k as Row).tag : JSON.stringify(k))).join("+");

// The closure is made for the one call, captures locals of the caller, and is called many times.
function sortedBy(rows: Row[], factor: number): string {
  let calls = 0;
  const out = rows.sort((a, b) => {
    calls++;
    return (a.rank - b.rank) * factor;
  });
  return out.map(r => r.rank).join("") + (calls > 0);
}
function replaced(text: string, table: Record<string, string>): string {
  let count = 0;
  return text.replace(/[a-c]/g, letter => table[letter] + ++count);
}
function stringified(value: unknown, hide: string): string {
  const path: string[] = [];
  return JSON.stringify(value, (key, inner) => {
    path.push(key);
    return key === hide ? undefined : inner;
  }) + path.join("/");
}
let line = "";
for (let i = 0; i < 300; i++) line = [sortedBy([row(3), row(1), row(2)], i % 2 ? 1 : -1), replaced("abcd", { a: "x", b: "y", c: "z" }), stringified({ a: 1, b: { c: 2, hidden: 3 } }, "hidden")].join();
console.log(line);

// The callback keeps what it was handed.
function keepsFromSort(rows: Row[]): void {
  rows.sort((a, b) => {
    if (kept.length < 2) kept.push(a, b);
    return a.rank - b.rank;
  });
}
function keepsFromReplace(text: string): string {
  return text.replace(/(\d)(?<name>x)/g, (...all) => {
    kept.push(all[all.length - 1], all);
    return "";
  });
}
function keepsFromStringify(value: unknown): void {
  JSON.stringify(value, function (this: unknown, key, inner) {
    if (key === "deep") kept.push(this, inner);
    return inner;
  });
}
function keepsFromParse(text: string): void {
  JSON.parse(text, function (this: unknown, key, inner) {
    if (key === "deep") kept.push(this, inner);
    return inner;
  });
}
function keepsFromIteration(rows: Row[]): void {
  rows.forEach((r, i, whole) => i === 0 && kept.push(r, whole));
  rows.reduce((acc, r) => (kept.push(acc), r));
  rows.flatMap(r => (kept.push(r), []));
  rows.find(r => (kept.push(r), true));
  Array.from(rows, r => kept.push(r));
  new Map([[rows[0], rows[1]]]).forEach((value, key, map) => kept.push(value, key, map.size));
  new Set(rows).forEach(r => kept.push(r));
}
for (let i = 0; i < 50; i++) {
  kept.length = 0;
  keepsFromSort([row(2, "sorted two " + i), row(1, "sorted one " + i)]);
  keepsFromReplace("1x" + i);
  keepsFromStringify({ tag: "holder " + i, deep: { tag: "deep value " + i } });
  keepsFromParse('{"tag":"parsed holder ' + i + '","deep":{"tag":"parsed deep ' + i + '"}}');
  keepsFromIteration([row(1, "first " + i), row(2, "second " + i)]);
}
console.log(churn(60), tags(kept));

// The callback changes the collection under the built-in.
function mutating(): string {
  const out: string[] = [];
  const a = [1, 2, 3, 4];
  a.forEach((n, i) => {
    out.push("f" + n);
    if (i === 0) a.pop();
    if (i === 1) a[2] = 30;
  });
  const b = [1, 2, 3];
  out.push("m" + b.map((n, i) => (i === 0 && b.push(9), i === 1 && (b.length = 2), n)).join("."));
  const c = [5, 1, 4];
  c.sort((x, y) => (c.push(0), x - y));
  out.push("s" + c.length);
  const d = [1, 2, 3];
  out.push("r" + d.reduce((sum, n) => (d.shift(), sum + n), 0));
  const e = new Set([1, 2]);
  e.forEach(n => n < 4 && e.add(n + 2));
  out.push("e" + [...e].join("."));
  const f = new Map([[1, "a"]]);
  f.forEach((v, k) => k < 3 && (f.delete(k), f.set(k + 1, v + k)));
  out.push("p" + [...f].join("."));
  const g: (number | undefined)[] = [1, 2, 3];
  out.push("i" + g.findIndex((n, i) => (delete g[i + 1], n === undefined)));
  return out.join();
}
for (let i = 0; i < 100; i++) line = mutating();
console.log(line);

// The callback throws out of the built-in; the thrown value is an operand.
function throwsFrom(which: number, rows: Row[]): unknown {
  try {
    if (which === 0) rows.sort(a => { throw a; });
    if (which === 1) rows.map(r => { throw r; });
    if (which === 2) JSON.stringify(rows, (key, inner) => { if (key === "0") throw inner; return inner; });
    if (which === 3) "x".replace("x", () => { throw rows[1]; });
    if (which === 4) Array.from(rows, r => { throw r; });
    if (which === 5) new Promise(() => { throw rows[0]; }).catch(error => kept.push(error));
    return "nothing thrown";
  } catch (error) {
    return error;
  }
}
kept.length = 0;
const thrown: unknown[] = [];
for (let which = 0; which < 6; which++) thrown.push(throwsFrom(which, [row(1, "t" + which + "a"), row(2, "t" + which + "b")]));
await null;
console.log(churn(40), tags(thrown), tags(kept));

// The callback enters the same built-in, and the helper that called it, again.
function nestedSort(depth: number): string {
  const rows = [row(2), row(1), row(3)];
  let inner = "";
  rows.sort((a, b) => {
    if (depth > 0 && inner === "") inner = nestedSort(depth - 1);
    return a.rank - b.rank;
  });
  return rows.map(r => r.rank).join("") + inner;
}
function nestedReplace(text: string, depth: number): string {
  return text.replace(/\((\w+)\)/g, (_, word: string) => (depth > 0 ? nestedReplace("(" + word + word + ")", depth - 1) : word));
}
console.log(nestedSort(3), nestedReplace("(a)-(b)", 2));

// `this` of the callback, and callbacks that are no closures.
class Scale {
  constructor(public factor: number) {}
  apply(n: number): number {
    return n * this.factor;
  }
}
console.log([1, 2].map(Scale.prototype.apply, new Scale(3)).join(), [1, 2].map(new Scale(4).apply.bind(new Scale(5))).join(), ["1", "2", "3"].map(Number).join(), ["10", "10", "10"].map(parseInt as never).join(), [1, 2].map(String).join("|"), [[1], [2]].map(Array.prototype.concat.call.bind(Array.prototype.concat) as never).length, [0, 1, ""].filter(Boolean).join());

// GENERATED: churn nestedReplace Scale apply
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
// CHECK-LABEL: function {{*}}name="nestedReplace"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="replace"
// CHECK-NEXT: v3 = NewRegExp pattern="\\((\\w+)\\)" regExpFlags=[Global]
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v5 = Call v2, v0, v3, v4 calleeKey="replace" calleeName="text.replace"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Scale"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_5]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_5]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_6]]
// CHECK-NEXT: PropSet v4, v1 key="factor"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="apply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_5]]} parameters=[{type=number}] results=[{type=number}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: [[L_5]], v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="factor"
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
