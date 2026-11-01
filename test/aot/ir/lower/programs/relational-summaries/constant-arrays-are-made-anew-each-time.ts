// RUN: lower
// OPTIONS: builtin-modules

// An array literal of constants can lie in read-only data as long as nobody writes it, asks who it is, or keeps it where a write may follow. Each evaluation of the literal is a new array: a change to one is not seen in the next, two are never the same, and a helper that "only reads" may hand it to one that sorts.
function primes(): number[] {
  return [2, 3, 5, 7, 11];
}
function names(): string[] {
  return ["ada", "grace", "edsger"];
}
function grid(): number[][] {
  return [
    [1, 2],
    [3, 4],
  ];
}
function mixed(): (number | string | null | boolean)[] {
  return [1, "two", null, true, 2.5, -0];
}
function holes(): (number | undefined)[] {
  return [1, , 3];
}
function empty(): number[] {
  return [];
}
function records(): { id: number; tags: string[] }[] {
  return [
    { id: 1, tags: ["a"] },
    { id: 2, tags: [] },
  ];
}
function sumOf(list: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
function largest(list: number[]): number {
  return list.sort((a, b) => b - a)[0];
}
function readsOrSorts(list: number[], sorts: boolean): number {
  return sorts ? largest(list) : list[0];
}
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sumOf(primes()) + sumOf([1, 2, 3]) + names().length + grid()[1][0] + readsOrSorts([4, 9, 6], false) + mixed().length + empty().length + records()[1].id;
console.log(warm);

// Two evaluations are two arrays.
console.log(primes() === primes(), grid()[0] === grid()[0], records()[0] === records()[0], records()[0].tags === records()[0].tags, empty() === empty(), new Set([primes(), primes()]).size, Object.is(mixed()[5], -0));
function twice(): boolean {
  const lists: number[][] = [];
  for (let i = 0; i < 2; i++) lists.push([1, 2, 3]);
  return lists[0] === lists[1];
}
console.log(twice());

// Every way to change one, and then a new one is looked at.
const changes: [string, (list: number[]) => unknown][] = [
  ["store", l => (l[0] = 99)],
  ["push", l => l.push(99)],
  ["pop", l => l.pop()],
  ["shift", l => l.shift()],
  ["unshift", l => l.unshift(99)],
  ["sort", l => l.sort((a, b) => b - a)],
  ["reverse", l => l.reverse()],
  ["splice", l => l.splice(1, 2)],
  ["fill", l => l.fill(0)],
  ["copyWithin", l => l.copyWithin(0, 3)],
  ["length", l => (l.length = 1)],
  ["grow", l => (l[10] = 1)],
  ["delete", l => delete l[0]],
  ["a double", l => (l[0] = 0.5)],
  ["a string", l => ((l as unknown[])[0] = "s")],
  ["a property", l => ((l as unknown as { extra: number }).extra = 1)],
  ["defineProperty", l => Object.defineProperty(l, 0, { value: 99 })],
  ["an accessor", l => Object.defineProperty(l, 0, { get: () => 99 })],
  ["assign", l => Object.assign(l, [99, 98])],
  ["Reflect.set", l => Reflect.set(l, 0, 99)],
  ["swap", l => ([l[0], l[1]] = [l[1], l[0]])],
  ["increment", l => l[0]++],
  ["compound", l => (l[0] += 5)],
  ["destructuring", l => ([l[0]] = [99])],
  ["for-of target", l => {
    for (l[0] of [99]);
  }],
  ["borrowed push", l => Array.prototype.push.call(l, 99)],
  ["freeze", l => Object.freeze(l)],
  ["seal", l => Object.seal(l)],
  ["setPrototypeOf", l => Object.setPrototypeOf(l, null)],
];
for (const [name, change] of changes) {
  const mine = primes();
  change(mine);
  const next = primes();
  console.log(name + ":", Array.prototype.join.call(mine, "/"), "|", next.join("/"), Object.isFrozen(next), Object.isSealed(next), Object.getPrototypeOf(next) === Array.prototype, Object.keys(next).length);
}

// The literal goes to a helper that sorts on a rare path; the caller reads it afterwards, and the next round gets a new one.
let trace = "";
for (let i = 0; i < 300; i++) {
  const list = [4, 9, 6];
  const answer = readsOrSorts(list, i % 100 === 99);
  if (i % 100 >= 98) trace += answer + ":" + list.join("") + " ";
}
console.log(trace);

// Kept, and written much later.
const keptLists: number[][] = [];
function keepSome(list: number[], i: number): number {
  if (i % 100 === 50) keptLists.push(list);
  return list[1];
}
for (let i = 0; i < 300; i++) warm += keepSome([10, 20, 30], i);
keptLists[0][1] = -1;
keptLists[1].push(40);
console.log(keptLists.map(l => l.join("/")).join(" "), keepSome([10, 20, 30], 1), keptLists[0] === keptLists[1]);

// Inner arrays and objects of a constant literal.
const g1 = grid();
g1[0][0] = 100;
g1[1] = [0];
const r1 = records();
r1[0].tags.push("b");
r1[1].id = 20;
console.log(JSON.stringify(g1), JSON.stringify(grid()), JSON.stringify(r1), JSON.stringify(records()));

// Holes stay holes; strings stay what they were.
const h = holes();
console.log(1 in h, h.length, Object.keys(h).join(), (h[1] = 2), 1 in holes(), names().map(n => n.toUpperCase()).join(), names().join());

// A default parameter, a class field, a spread, a template's strings.
function withDefault(list: number[] = [1, 2]): number[] {
  list.push(3);
  return list;
}
class WithField {
  list = [1, 2];
}
function tag(strings: TemplateStringsArray, ...values: number[]): TemplateStringsArray {
  return strings;
}
function tagged(): TemplateStringsArray {
  return tag`a${1}b`;
}
console.log(withDefault().join(), withDefault().join(), new WithField().list === new WithField().list, (new WithField().list.push(3), new WithField().list.join()), [...[1, 2]].concat([3]).join());
console.log(tagged() === tagged(), Object.isFrozen(tagged()), tagged().raw === tagged().raw, tag`a${1}b` === tag`a${1}b`);

// Typed arrays and constant arguments of built-ins.
function bytes(): Uint8Array {
  return new Uint8Array([1, 2, 3]);
}
const b1 = bytes();
b1[0] = 9;
console.log(b1.join(), bytes().join(), Math.max(...[1, 5, 3]), [3, 1, 2].sort().join(), [3, 1, 2].toSorted().join(), [1, 2, 3].includes(2), [1, 2, 3].indexOf(4), ["a", "b"].join("-"), [[1, 2], [3]].flat().join(), new Map([[1, "x"]]).get(1), new Set([1, 1, 2]).size);

// GENERATED: tag mixed holes keepSome tagged bytes WithField get
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}, {type=Array<number> site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|string>, v1: Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|boolean|number|string> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|boolean|number|string> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="holes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|number> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Integer integer=3
// CHECK-NEXT: v2 = NewArray v0, v1 contents=undefined|number holes=[1]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|number> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keepSome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_6]]}] results=[{type=number site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=100
// CHECK-NEXT: v3 = Mod v1, v2
// CHECK-NEXT: v4 = Integer integer=50
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="keptLists"
// CHECK-NEXT: v8 = PropGet v7 key="push"
// CHECK-NEXT: v9 = Call v8, v7, v0 calleeKey="push" calleeName="keptLists.push"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_9]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = ElemGet v0, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_10]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tagged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v1 = NewTemplateObject templateStrings=[{cooked="a" raw="a"}, {cooked="b" raw="b"}]
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Call v0, -, v1, v2 calleeName="tag"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}}, {declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bytes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Uint8Array site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Uint8Array
// CHECK-NEXT: v1 = Data data=[[d_13]]
// CHECK-NEXT: v2 = Construct v0, -, v1 calleeName="Uint8Array"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Uint8Array site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="WithField"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_15]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_15]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_16]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_17]]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=99
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
