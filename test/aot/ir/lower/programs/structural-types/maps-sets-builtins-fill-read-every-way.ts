// RUN: lower
// OPTIONS: builtin-modules

// Maps and sets that built ins fill are read in every way.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function total(numbers: Iterable<number>): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}

attempt("a map from pairs", () => {
  const map = new Map([
    ["a", 1],
    ["b", 2],
  ]);
  return [map.get("a"), map.get("c"), map.has("b"), map.size, total(map.values()), [...map.keys()].join()];
});
attempt("a map from a map", () => {
  const map = new Map(new Map([[1, "one"]]));
  return [map.get(1)?.length, map.size, [...map].length];
});
attempt("a map from entries of an object", () => {
  const map = new Map(Object.entries({ a: 1, b: 2 }));
  return [map.get("b"), total(map.values())];
});
attempt("a map from a generator", () => {
  function* pairs(): Generator<[string, number]> {
    yield ["a", 1];
    yield ["b", 2];
  }
  const map = new Map(pairs());
  return [map.get("a"), map.size, total(map.values())];
});
attempt("a map from mapped pairs", () => {
  const map = new Map([1, 2, 3].map(n => [n, { n }]));
  return [map.get(2)?.n, map.size, [...map.values()].map(o => o.n)];
});
attempt("a set from a list, a text, a set and the keys of a map", () => {
  const fromList = new Set([1, 2, 2]);
  const fromText = new Set("aab");
  const fromSet = new Set(fromList);
  const fromKeys = new Set(new Map([[5, "five"]]).keys());
  return [fromList.size, fromList.has(2), total(fromList), fromText.size, [...fromText].join(), total(fromSet), fromKeys.has(5), total(fromKeys)];
});
attempt("what the methods of sets return", () => {
  const a = new Set([1, 2, 3]);
  const b = new Set([2, 3, 4]);
  return [
    [...a.union(b)],
    [...a.intersection(b)],
    [...a.difference(b)],
    [...a.symmetricDifference(b)],
    a.union(b).has(4),
    a.difference(b).size,
    total(a.symmetricDifference(b)),
    a.isSubsetOf(b),
    a.isSupersetOf(new Set([1])),
    a.isDisjointFrom(new Set([9])),
  ];
});
attempt("a set joined with a map", () => {
  const joined = new Set([1]).union(new Map([[2, "two"]]));
  return [[...joined], joined.has(2)];
});
attempt("iterators of a map turned into lists", () => {
  const map = new Map([
    ["a", 1],
    ["b", 2],
  ]);
  const entries = map.entries().toArray();
  const keys = Array.from(map.keys());
  const values = [...map.values()];
  return [entries[1][0], entries[1][1] + 1, keys[0].length, values[1] + 1, Array.from(map, ([key, n]) => key + n)];
});
attempt("forEach", () => {
  const seen: string[] = [];
  new Map([["a", 1]]).forEach((n, key, map) => seen.push(key + (n + 1) + map.size));
  new Set(["s"]).forEach((value, again, set) => seen.push(value + again + set.size));
  return seen;
});
attempt("a weak map and a weak set from lists", () => {
  const key = { id: 1 };
  const weak = new WeakMap([[key, "value"]]);
  const set = new WeakSet([key]);
  return [weak.get(key)?.length, weak.has(key), weak.get({ id: 1 }), set.has(key)];
});
attempt("what set returns", () => {
  const map = new Map<string, number>();
  const n = map.set("a", 1).set("b", 2).get("b");
  const set = new Set<number>().add(1).add(2);
  return [n, map.size, set.size, total(set)];
});
attempt("a map whose values are maps", () => {
  const outer = new Map([["o", new Map([["i", 1]])]]);
  return [outer.get("o")?.get("i"), [...(outer.get("o")?.keys() ?? [])].join()];
});
attempt("a map grouped by hand", () => {
  const groups = new Map<number, number[]>();
  for (const n of [1, 2, 3]) {
    const list = groups.get(n % 2);
    if (list) list.push(n);
    else groups.set(n % 2, [n]);
  }
  return [groups.get(1), groups.get(0), groups.size];
});
attempt("deleted and cleared", () => {
  const map = new Map([
    ["a", 1],
    ["b", 2],
  ]);
  const deleted = map.delete("a");
  const after = [map.get("a"), map.get("b"), map.size];
  map.clear();
  return [deleted, after, map.get("b"), map.size, [...map].length];
});

export {};

// GENERATED: total pairs
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_1]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_2]]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=number site=[[w_1]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Convert v8 declared={type=number site=[[w_3]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = Add v4, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pairs"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|Array<undefined|null|number|string>> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Data data=[[d_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|number|string> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Data data=[[d_6]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|number|string> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Yield v9
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b7():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
