// RUN: lower
// OPTIONS: builtin-modules

// The own keys of an instance stand in the order in which its constructor's stores ran, whatever the compiler knows about fields that every constructor fills: Object.keys, entries, for-in, JSON.stringify, spread, Reflect.ownKeys; a field deleted and added again, stored on one path only, taken by a setter or stopped by a read-only property above, redefined, or missing because the constructor threw
const lines: string[] = [];
function show(title: string, object: object): void {
  const inLoop: string[] = [];
  for (const key in object) inLoop.push(key);
  lines.push(
    title + ": " + Object.keys(object).join(",") + " | " + Object.entries(object).map(([key, value]) => key + "=" + String(value)).join(",") + " | " + inLoop.join(",") +
      " | " + JSON.stringify(object) + " | " + Object.keys({ ...object }).join(",") + " | " + Reflect.ownKeys(object).map(String).join(",") + " | " + Object.getOwnPropertyNames(object).join(","),
  );
}

interface Leaf { pos: number; end: number; kind: number; id: number; flags: number; parent: Leaf | undefined; note?: string }
function Leaf(this: Leaf, kind: number, pos: number, end: number) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
  this.id = 0;
  this.flags = 0;
  this.parent = undefined;
}
interface Token { kind: number; flags: number; pos: number; text?: string; end: number }
function Token(this: Token, kind: number, pos: number, end: number) {
  this.kind = kind;
  this.flags = kind & 1;
  this.pos = pos;
  if (kind > 2) this.text = "t" + kind;
  this.end = end;
}
const allocator = {
  getLeafConstructor: () => Leaf as unknown as new (kind: number, pos: number, end: number) => Leaf,
  getTokenConstructor: () => Token as unknown as new (kind: number, pos: number, end: number) => Token,
};
function makeLeaf(kind: number, pos: number, end: number): Leaf {
  return new (allocator.getLeafConstructor())(kind, pos, end);
}
function makeToken(kind: number, pos: number, end: number): Token {
  return new (allocator.getTokenConstructor())(kind, pos, end);
}
function sumOfLeaf(leaf: Leaf): number {
  return leaf.kind * 1000 + leaf.flags * 100 + leaf.pos * 10 + leaf.end + leaf.id + (leaf.parent ? leaf.parent.kind : 0);
}

class Point {
  y: number;
  x: number;
  label: string | undefined;
  constructor(x: number, y: number, label?: string) {
    this.x = x;
    if (label !== undefined) this.label = label;
    this.y = y;
  }
}
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const parent = makeLeaf(i % 7, i, i + 1);
  const leaf = makeLeaf(i % 5, i, i + 2);
  leaf.parent = parent;
  leaf.flags |= i & 3;
  total += sumOfLeaf(leaf) + makeToken(i % 5, i, i + 1).end;
}
lines.push("total " + total);

show("leaf", makeLeaf(1, 2, 3));
show("token without text", makeToken(1, 2, 3));
show("token with text", makeToken(3, 2, 3));
show("point", new Point(1, 2));
show("point with label", new Point(1, 2, "p"));
show("point3", new Point3(1, 2, 3));

const again = makeLeaf(4, 5, 6);
delete (again as Partial<Leaf>).kind;
show("kind deleted", again);
lines.push("kind reads " + String(again.kind) + " " + ("kind" in again) + " " + sumOfLeaf(again));
again.kind = 9;
show("kind added again", again);
lines.push("sum " + sumOfLeaf(again));

const late = makeLeaf(1, 1, 1);
late.note = "late";
delete (late as Partial<Leaf>).pos;
late.pos = 7;
show("a late field, then pos again", late);

const other = makeLeaf(2, 2, 2);
(other as unknown as { flags: unknown }).flags = "many";
show("flags holds a string", other);
lines.push("flags reads " + String((other as unknown as { flags: unknown }).flags));

const redefined = makeLeaf(3, 3, 3);
Object.defineProperty(redefined, "kind", { get: () => 42, enumerable: true, configurable: true });
show("kind is an accessor", redefined);
lines.push("sum " + sumOfLeaf(redefined));
Object.defineProperty(redefined, "flags", { value: 5, enumerable: false, writable: true, configurable: true });
show("flags is not enumerable", redefined);
lines.push("sum " + sumOfLeaf(redefined));

const taken: number[] = [];
Object.defineProperty(Leaf.prototype, "flags", { set(value: number) { taken.push(value); }, get() { return -1; }, configurable: true });
const underSetter = makeLeaf(5, 5, 5);
show("made under a setter for flags", underSetter);
lines.push("flags reads " + underSetter.flags + ", own " + Object.hasOwn(underSetter, "flags") + ", taken " + taken.join(",") + ", sum " + sumOfLeaf(underSetter));
delete (Leaf.prototype as Partial<Leaf>).flags;
lines.push("behind the setter flags reads " + String(underSetter.flags) + ", sum " + sumOfLeaf(underSetter));
underSetter.flags = 1;
show("flags stored later", underSetter);
show("made behind the setter", makeLeaf(5, 5, 5));

Object.defineProperty(Leaf.prototype, "id", { value: 77, writable: false, configurable: true });
let stopped: Leaf | undefined;
let holder: Leaf | undefined;
function Watched(this: Leaf, kind: number) {
  holder = this;
  Leaf.call(this, kind, 1, 2);
}
Watched.prototype = Object.create(Leaf.prototype);
try {
  stopped = makeLeaf(6, 6, 6);
} catch (error) {
  lines.push("stopped: " + (error as Error).constructor.name);
}
lines.push("stopped is " + String(stopped));
try {
  new (Watched as unknown as new (kind: number) => Leaf)(6);
} catch (error) {
  lines.push("watched: " + (error as Error).constructor.name);
}
show("left half made", holder!);
lines.push("id reads " + holder!.id + ", flags " + String(holder!.flags) + ", sum " + sumOfLeaf(holder!));
delete (Leaf.prototype as Partial<Leaf>).id;
show("made behind the read-only id", makeLeaf(6, 6, 6));
show("watched", new (Watched as unknown as new (kind: number) => Leaf)(7));

class Other {}
show("another new.target", Reflect.construct(Leaf, [8, 8, 8], Other));
lines.push("is Other " + (Reflect.construct(Leaf, [8, 8, 8], Other) instanceof Other));
const onPlainObject = { first: 1 } as unknown as Leaf;
Leaf.call(onPlainObject, 9, 9, 9);
show("called on a plain object", onPlainObject);
const twice = makeLeaf(1, 1, 1);
delete (twice as Partial<Leaf>).end;
Leaf.call(twice, 2, 2, 2);
show("constructed twice", twice);

let seenEarly = "";
function peek(leaf: Early): void {
  seenEarly += Object.keys(leaf).join(",") + ";" + String(leaf.b) + ";";
}
class Early {
  a: number;
  b: number;
  constructor() {
    seenEarly += String((this as Partial<Early>).a) + ";";
    this.a = 1;
    peek(this);
    this.b = 2;
    peek(this);
  }
}
show("early", new Early());
lines.push("seen early " + seenEarly);

const frozen = Object.freeze(makeLeaf(1, 2, 3));
try {
  (frozen as Leaf).kind = 5;
} catch (error) {
  lines.push("frozen: " + (error as Error).constructor.name);
}
show("frozen", frozen);
lines.push("sum " + sumOfLeaf(frozen));

console.log(lines.join("\n"));

// GENERATED: Early getLeafConstructor Point3
// CHECK-LABEL: function {{*}}name="Early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="seenEarly"
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Convert v3 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = PropGet v8 key="a"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|number} illTypedCause=Assertion
// CHECK-NEXT: v11 = Call v7, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = String string=";"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Add v6, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="seenEarly"
// CHECK-NEXT: PutModuleVariable v16 variable=[[g_3]]
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Convert v20 declared={type=number site=[[w_7]]}
// CHECK-NEXT: PropSet v3, v21 key="a"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v24 = Call v23, -, v3 calleeName="peek"
// CHECK-NEXT: v25 = Integer integer=2
// CHECK-NEXT: v26 = Convert v25 declared={type=number site=[[w_9]]}
// CHECK-NEXT: PropSet v3, v26 key="b"
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v29 = Call v28, -, v3 calleeName="peek"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: v31 = TypeTest v30 testedType=object
// CHECK-NEXT: Branch v31 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v32):
// CHECK-NEXT: Jump -> next b4(v32)
// CHECK-NEXT: b3(v33):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v34):
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getLeafConstructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|[[f_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_10]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point3"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=number site=[[w_15]]}, {type=number site=[[w_16]]}, {type=number site=[[w_17]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: number, v3: number, v4: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = Absent
// CHECK-NEXT: v6 = GetSuperBase v0
// CHECK-NEXT: v7 = SuperConstruct v6, v1, v2, v3 layout=[[L_19]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[L_19]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = CallDirect v8 function=[[f_20]]
// CHECK-NEXT: v12 = TypeTest v8 testedType=absent
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v13) frequency=Unlikely:
// CHECK-NEXT: v14 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v14
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = Convert v4 declared={type=number site=[[w_21]]}
// CHECK-NEXT: PropSet v15, v16 key="z"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v23):
// CHECK-NEXT: v24 = TypeTest v15 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v25) frequency=Unlikely:
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: Jump -> next b10(v27)
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b11(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="Point3"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b12(v31) frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
