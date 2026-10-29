// RUN: lower
// OPTIONS: builtin-modules

// An object that a function made and returned can be changed by whoever reaches it through something it holds: a copy of one of its properties, taken by a constant that is declared before the change, keeps the old value.
type Node = { n: number; k0?: unknown; k1?: unknown };
const KEY = "back";
function wrap(it: Node): { back: Node } { return { back: it }; }
function either(flag: boolean, a: Node, b: Node): Node { return flag ? a : b; }
function listOf(a: Node, b: Node): Node[] { return [a, b]; }
function thunk(it: Node): () => Node { function get(): Node { return it; } return get; }
class Holder { constructor(public back: Node) {} }
const visited = new Set<unknown>();
function changeAllReachableFrom(value: unknown): void {
  if (typeof value === "function") { if (!visited.has(value)) { visited.add(value); try { changeAllReachableFrom((value as () => unknown)()); } catch {} } return; }
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);
  if (value instanceof Map) { for (const [key, held] of value) { changeAllReachableFrom(key); changeAllReachableFrom(held); } return; }
  if (value instanceof Set) { for (const held of value) changeAllReachableFrom(held); return; }
  if (Array.isArray(value)) { for (const held of value) changeAllReachableFrom(held); return; }
  const record = value as Record<string, unknown>;
  const described = Object.getOwnPropertyDescriptors(record);
  for (const key of Object.keys(described)) { if (described[key]!.set) { try { record[key] = 99; } catch {} } else changeAllReachableFrom(record[key]); }
  if (typeof record["n"] === "number") { try { record["n"] = 99; } catch {} }
}

function makeACondition(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { back: flag ? made : other };
  return made;
}
const heldACondition = makeACondition(true);
const copyOfACondition = { seen: heldACondition.n };
function changeACondition(): void { changeAllReachableFrom(heldACondition.k0); changeAllReachableFrom(heldACondition.k1); }
function readACondition(): number { return copyOfACondition.seen; }
function makeAConditionBare(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = flag ? made : other;
  return made;
}
const heldAConditionBare = makeAConditionBare(true);
const copyOfAConditionBare = { seen: heldAConditionBare.n };
function changeAConditionBare(): void { changeAllReachableFrom(heldAConditionBare.k0); changeAllReachableFrom(heldAConditionBare.k1); }
function readAConditionBare(): number { return copyOfAConditionBare.seen; }
function makeAnAnd(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { back: flag && made };
  return made;
}
const heldAnAnd = makeAnAnd(true);
const copyOfAnAnd = { seen: heldAnAnd.n };
function changeAnAnd(): void { changeAllReachableFrom(heldAnAnd.k0); changeAllReachableFrom(heldAnAnd.k1); }
function readAnAnd(): number { return copyOfAnAnd.seen; }
function makeAnOr(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { back: (flag ? null : other) || made };
  return made;
}
const heldAnOr = makeAnOr(true);
const copyOfAnOr = { seen: heldAnOr.n };
function changeAnOr(): void { changeAllReachableFrom(heldAnOr.k0); changeAllReachableFrom(heldAnOr.k1); }
function readAnOr(): number { return copyOfAnOr.seen; }
function makeANullish(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { back: (flag ? null : other) ?? made };
  return made;
}
const heldANullish = makeANullish(true);
const copyOfANullish = { seen: heldANullish.n };
function changeANullish(): void { changeAllReachableFrom(heldANullish.k0); changeAllReachableFrom(heldANullish.k1); }
function readANullish(): number { return copyOfANullish.seen; }
function makeAHelperThatPicks(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { back: either(flag, made, other) };
  return made;
}
const heldAHelperThatPicks = makeAHelperThatPicks(true);
const copyOfAHelperThatPicks = { seen: heldAHelperThatPicks.n };
function changeAHelperThatPicks(): void { changeAllReachableFrom(heldAHelperThatPicks.k0); changeAllReachableFrom(heldAHelperThatPicks.k1); }
function readAHelperThatPicks(): number { return copyOfAHelperThatPicks.seen; }
function makeAVariableAssignedUnderACondition(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  { let v: Node = other; if (flag) v = made; made.k0 = { back: v }; }
  return made;
}
const heldAVariableAssignedUnderACondition = makeAVariableAssignedUnderACondition(true);
const copyOfAVariableAssignedUnderACondition = { seen: heldAVariableAssignedUnderACondition.n };
function changeAVariableAssignedUnderACondition(): void { changeAllReachableFrom(heldAVariableAssignedUnderACondition.k0); changeAllReachableFrom(heldAVariableAssignedUnderACondition.k1); }
function readAVariableAssignedUnderACondition(): number { return copyOfAVariableAssignedUnderACondition.seen; }
function makeALoopThatStores(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  { const h: { back: Node | null } = { back: null }; for (const x of [other, made]) h.back = x; made.k0 = h; }
  return made;
}
const heldALoopThatStores = makeALoopThatStores(true);
const copyOfALoopThatStores = { seen: heldALoopThatStores.n };
function changeALoopThatStores(): void { changeAllReachableFrom(heldALoopThatStores.k0); changeAllReachableFrom(heldALoopThatStores.k1); }
function readALoopThatStores(): number { return copyOfALoopThatStores.seen; }
function makeAListOfTwo(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = [made, other];
  return made;
}
const heldAListOfTwo = makeAListOfTwo(true);
const copyOfAListOfTwo = { seen: heldAListOfTwo.n };
function changeAListOfTwo(): void { changeAllReachableFrom(heldAListOfTwo.k0); changeAllReachableFrom(heldAListOfTwo.k1); }
function readAListOfTwo(): number { return copyOfAListOfTwo.seen; }
function makeAHelperThatLists(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = listOf(made, other);
  return made;
}
const heldAHelperThatLists = makeAHelperThatLists(true);
const copyOfAHelperThatLists = { seen: heldAHelperThatLists.n };
function changeAHelperThatLists(): void { changeAllReachableFrom(heldAHelperThatLists.k0); changeAllReachableFrom(heldAHelperThatLists.k1); }
function readAHelperThatLists(): number { return copyOfAHelperThatLists.seen; }
function makeALoopOverTwoThatPushes(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  { const l: Node[] = []; for (const x of [made, other]) l.push(x); made.k0 = l; }
  return made;
}
const heldALoopOverTwoThatPushes = makeALoopOverTwoThatPushes(true);
const copyOfALoopOverTwoThatPushes = { seen: heldALoopOverTwoThatPushes.n };
function changeALoopOverTwoThatPushes(): void { changeAllReachableFrom(heldALoopOverTwoThatPushes.k0); changeAllReachableFrom(heldALoopOverTwoThatPushes.k1); }
function readALoopOverTwoThatPushes(): number { return copyOfALoopOverTwoThatPushes.seen; }
function makeAMapValue(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = new Map<string, Node>([["x", made]]);
  return made;
}
const heldAMapValue = makeAMapValue(true);
const copyOfAMapValue = { seen: heldAMapValue.n };
function changeAMapValue(): void { changeAllReachableFrom(heldAMapValue.k0); changeAllReachableFrom(heldAMapValue.k1); }
function readAMapValue(): number { return copyOfAMapValue.seen; }
function makeAMapKey(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = new Map<Node, number>([[made, 1]]);
  return made;
}
const heldAMapKey = makeAMapKey(true);
const copyOfAMapKey = { seen: heldAMapKey.n };
function changeAMapKey(): void { changeAllReachableFrom(heldAMapKey.k0); changeAllReachableFrom(heldAMapKey.k1); }
function readAMapKey(): number { return copyOfAMapKey.seen; }
function makeAComputedKey(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { [KEY]: made };
  return made;
}
const heldAComputedKey = makeAComputedKey(true);
const copyOfAComputedKey = { seen: heldAComputedKey.n };
function changeAComputedKey(): void { changeAllReachableFrom(heldAComputedKey.k0); changeAllReachableFrom(heldAComputedKey.k1); }
function readAComputedKey(): number { return copyOfAComputedKey.seen; }
function makeAProxyTarget(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = new Proxy(made, {});
  return made;
}
const heldAProxyTarget = makeAProxyTarget(true);
const copyOfAProxyTarget = { seen: heldAProxyTarget.n };
function changeAProxyTarget(): void { changeAllReachableFrom(heldAProxyTarget.k0); changeAllReachableFrom(heldAProxyTarget.k1); }
function readAProxyTarget(): number { return copyOfAProxyTarget.seen; }
function makeAFunctionDeclaration(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  { function get(): Node { return made; } made.k0 = get; }
  return made;
}
const heldAFunctionDeclaration = makeAFunctionDeclaration(true);
const copyOfAFunctionDeclaration = { seen: heldAFunctionDeclaration.n };
function changeAFunctionDeclaration(): void { changeAllReachableFrom(heldAFunctionDeclaration.k0); changeAllReachableFrom(heldAFunctionDeclaration.k1); }
function readAFunctionDeclaration(): number { return copyOfAFunctionDeclaration.seen; }
function makeAFunctionDeclarationInAHelper(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = thunk(made);
  return made;
}
const heldAFunctionDeclarationInAHelper = makeAFunctionDeclarationInAHelper(true);
const copyOfAFunctionDeclarationInAHelper = { seen: heldAFunctionDeclarationInAHelper.n };
function changeAFunctionDeclarationInAHelper(): void { changeAllReachableFrom(heldAFunctionDeclarationInAHelper.k0); changeAllReachableFrom(heldAFunctionDeclarationInAHelper.k1); }
function readAFunctionDeclarationInAHelper(): number { return copyOfAFunctionDeclarationInAHelper.seen; }
function makeASetter(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { set n(v: number) { made.n = v; } };
  return made;
}
const heldASetter = makeASetter(true);
const copyOfASetter = { seen: heldASetter.n };
function changeASetter(): void { changeAllReachableFrom(heldASetter.k0); changeAllReachableFrom(heldASetter.k1); }
function readASetter(): number { return copyOfASetter.seen; }
function makeItself(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = made;
  return made;
}
const heldItself = makeItself(true);
const copyOfItself = { seen: heldItself.n };
function changeItself(): void { changeAllReachableFrom(heldItself.k0); changeAllReachableFrom(heldItself.k1); }
function readItself(): number { return copyOfItself.seen; }
function makeAField(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { back: made };
  return made;
}
const heldAField = makeAField(true);
const copyOfAField = { seen: heldAField.n };
function changeAField(): void { changeAllReachableFrom(heldAField.k0); changeAllReachableFrom(heldAField.k1); }
function readAField(): number { return copyOfAField.seen; }
function makeAList(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = [made];
  return made;
}
const heldAList = makeAList(true);
const copyOfAList = { seen: heldAList.n };
function changeAList(): void { changeAllReachableFrom(heldAList.k0); changeAllReachableFrom(heldAList.k1); }
function readAList(): number { return copyOfAList.seen; }
function makeASet(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = new Set<Node>([made]);
  return made;
}
const heldASet = makeASet(true);
const copyOfASet = { seen: heldASet.n };
function changeASet(): void { changeAllReachableFrom(heldASet.k0); changeAllReachableFrom(heldASet.k1); }
function readASet(): number { return copyOfASet.seen; }
function makeAnArrow(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = () => made;
  return made;
}
const heldAnArrow = makeAnArrow(true);
const copyOfAnArrow = { seen: heldAnArrow.n };
function changeAnArrow(): void { changeAllReachableFrom(heldAnArrow.k0); changeAllReachableFrom(heldAnArrow.k1); }
function readAnArrow(): number { return copyOfAnArrow.seen; }
function makeAMethod(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { get(): Node { return made; } };
  return made;
}
const heldAMethod = makeAMethod(true);
const copyOfAMethod = { seen: heldAMethod.n };
function changeAMethod(): void { changeAllReachableFrom(heldAMethod.k0); changeAllReachableFrom(heldAMethod.k1); }
function readAMethod(): number { return copyOfAMethod.seen; }
function makeAGetter(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { get back(): Node { return made; } };
  return made;
}
const heldAGetter = makeAGetter(true);
const copyOfAGetter = { seen: heldAGetter.n };
function changeAGetter(): void { changeAllReachableFrom(heldAGetter.k0); changeAllReachableFrom(heldAGetter.k1); }
function readAGetter(): number { return copyOfAGetter.seen; }
function makeAParameterProperty(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = new Holder(made);
  return made;
}
const heldAParameterProperty = makeAParameterProperty(true);
const copyOfAParameterProperty = { seen: heldAParameterProperty.n };
function changeAParameterProperty(): void { changeAllReachableFrom(heldAParameterProperty.k0); changeAllReachableFrom(heldAParameterProperty.k1); }
function readAParameterProperty(): number { return copyOfAParameterProperty.seen; }
function makeASpread(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = { ...{ back: made } };
  return made;
}
const heldASpread = makeASpread(true);
const copyOfASpread = { seen: heldASpread.n };
function changeASpread(): void { changeAllReachableFrom(heldASpread.k0); changeAllReachableFrom(heldASpread.k1); }
function readASpread(): number { return copyOfASpread.seen; }
function makeAssign(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = Object.assign({}, { back: made });
  return made;
}
const heldAssign = makeAssign(true);
const copyOfAssign = { seen: heldAssign.n };
function changeAssign(): void { changeAllReachableFrom(heldAssign.k0); changeAllReachableFrom(heldAssign.k1); }
function readAssign(): number { return copyOfAssign.seen; }
function makeMap(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  made.k0 = [made].map(x => x);
  return made;
}
const heldMap = makeMap(true);
const copyOfMap = { seen: heldMap.n };
function changeMap(): void { changeAllReachableFrom(heldMap.k0); changeAllReachableFrom(heldMap.k1); }
function readMap(): number { return copyOfMap.seen; }
function makePush(flag: boolean): Node {
  const made: Node = { n: 1 };
  const other: Node = { n: 0 };
  { const l: Node[] = []; l.push(made); made.k0 = l; }
  return made;
}
const heldPush = makePush(true);
const copyOfPush = { seen: heldPush.n };
function changePush(): void { changeAllReachableFrom(heldPush.k0); changeAllReachableFrom(heldPush.k1); }
function readPush(): number { return copyOfPush.seen; }

changeACondition();
changeAConditionBare();
changeAnAnd();
changeAnOr();
changeANullish();
changeAHelperThatPicks();
changeAVariableAssignedUnderACondition();
changeALoopThatStores();
changeAListOfTwo();
changeAHelperThatLists();
changeALoopOverTwoThatPushes();
changeAMapValue();
changeAMapKey();
changeAComputedKey();
changeAProxyTarget();
changeAFunctionDeclaration();
changeAFunctionDeclarationInAHelper();
changeASetter();
changeItself();
changeAField();
changeAList();
changeASet();
changeAnArrow();
changeAMethod();
changeAGetter();
changeAParameterProperty();
changeASpread();
changeAssign();
changeMap();
changePush();
console.log("a condition", String(readACondition()));
console.log("a condition bare", String(readAConditionBare()));
console.log("an and", String(readAnAnd()));
console.log("an or", String(readAnOr()));
console.log("a nullish", String(readANullish()));
console.log("a helper that picks", String(readAHelperThatPicks()));
console.log("a variable assigned under a condition", String(readAVariableAssignedUnderACondition()));
console.log("a loop that stores", String(readALoopThatStores()));
console.log("a list of two", String(readAListOfTwo()));
console.log("a helper that lists", String(readAHelperThatLists()));
console.log("a loop over two that pushes", String(readALoopOverTwoThatPushes()));
console.log("a map value", String(readAMapValue()));
console.log("a map key", String(readAMapKey()));
console.log("a computed key", String(readAComputedKey()));
console.log("a proxy target", String(readAProxyTarget()));
console.log("a function declaration", String(readAFunctionDeclaration()));
console.log("a function declaration in a helper", String(readAFunctionDeclarationInAHelper()));
console.log("a setter", String(readASetter()));
console.log("itself", String(readItself()));
console.log("a field", String(readAField()));
console.log("a list", String(readAList()));
console.log("a set", String(readASet()));
console.log("an arrow", String(readAnArrow()));
console.log("a method", String(readAMethod()));
console.log("a getter", String(readAGetter()));
console.log("a parameter property", String(readAParameterProperty()));
console.log("a spread", String(readASpread()));
console.log("assign", String(readAssign()));
console.log("map", String(readMap()));
console.log("push", String(readPush()));

// GENERATED: wrap makeAnOr makeALoopOverTwoThatPushes makeAMapKey makeAComputedKey makeAProxyTarget makeAFunctionDeclaration makeASetter makeASet makeAGetter makeAssign Holder get n back
// CHECK-LABEL: function {{*}}name="wrap"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="wrap"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeAnOr"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_4]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = ToBoolean v0
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Null
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6(v4)
// CHECK-NEXT: b6(v9):
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v11):
// CHECK-NEXT: Jump -> next b10(v11)
// CHECK-NEXT: b8(v12):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: Jump -> next b10(v2)
// CHECK-NEXT: b10(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|false|[[L_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v15 = NewObject -, v14 layout=[[L_8]] fields=[0]
// CHECK-NEXT: v16 = FinishObject v15
// CHECK-NEXT: PropSet v2, v16 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeALoopOverTwoThatPushes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_9]]}] results=[{type=undefined|null|[[L_2]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_11]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_13]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Data data=[[d_15]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|[[L_2]]> site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = NewArray v2, v4 contents=undefined|null|[[L_2]]
// CHECK-NEXT: v8 = IteratorOpen v7
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = IteratorResume v8
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Branch v11 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: PropSet v2, v6 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v14 = Convert v12 declared={type=undefined|null|[[L_2]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v15 = PropGet v6 key="push"
// CHECK-NEXT: v16 = Call v15, v6, v14 calleeKey="push" calleeName="l.push"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_18]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v8:
// CHECK-NEXT: v18 = CatchException
// CHECK-NEXT: IteratorClose v8 completion=Throw
// CHECK-NEXT: Rethrow v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeAMapKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_19]]}] results=[{type=undefined|null|[[L_2]] site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_21]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_23]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = Builtin builtin=Map
// CHECK-NEXT: v8 = Construct v7 calleeName="Map"
// CHECK-NEXT: v9 = Builtin builtin=MapPrototypeSet [isNotReadFromHolder]
// CHECK-NEXT: v10 = Call v9, v8, v2, v5
// CHECK-NEXT: v11 = Convert v8 declared={type=undefined|null|Map<undefined|null|[[L_2]], number> site=[[w_25]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v2, v11 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeAComputedKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_26]]}] results=[{type=undefined|null|[[L_2]] site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_28]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_30]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_31]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_32]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="KEY"
// CHECK-NEXT: v7 = ToPropertyKey v6
// CHECK-NEXT: v8 = NewObject layout=[[L_8]]
// CHECK-NEXT: ElemDefine v8, v7, v2
// CHECK-NEXT: v10 = FinishObject v8
// CHECK-NEXT: PropSet v2, v10 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeAProxyTarget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_33]]}] results=[{type=undefined|null|[[L_2]] site=[[w_34]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_35]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_36]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_37]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_38]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Builtin builtin=Proxy
// CHECK-NEXT: v6 = Data data=[[d_39]]
// CHECK-NEXT: v7 = Construct v5, -, v2, v6 calleeName="Proxy"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_2]] site=[[w_40]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v2, v8 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeAFunctionDeclaration"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_41]]}] results=[{type=undefined|null|[[L_2]] site=[[w_42]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_43]]
// CHECK-NEXT: v2 = Data data=[[d_44]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_2]] site=[[w_45]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_43]]
// CHECK-NEXT: v5 = Data data=[[d_46]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_2]] site=[[w_47]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = NewClosure v1 function=[[f_48]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[f_48]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v3, v8 key="k0"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeASetter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_49]]}] results=[{type=undefined|null|[[L_2]] site=[[w_50]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_51]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_52]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_53]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_54]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = NewObject layout=[[L_55]]
// CHECK-NEXT: v6 = NewClosure v2 function=[[f_56]]
// CHECK-NEXT: DefineSetter v5, v6 key="n"
// CHECK-NEXT: v8 = FinishObject v5
// CHECK-NEXT: PropSet v2, v8 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeASet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_57]]}] results=[{type=undefined|null|[[L_2]] site=[[w_58]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_59]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_60]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_61]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_62]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = Builtin builtin=Set
// CHECK-NEXT: v7 = Construct v6 calleeName="Set"
// CHECK-NEXT: v8 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v9 = Call v8, v7, v2
// CHECK-NEXT: v10 = Convert v7 declared={type=undefined|null|Set<undefined|null|[[L_2]]> site=[[w_63]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v2, v10 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeAGetter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_64]]}] results=[{type=undefined|null|[[L_2]] site=[[w_65]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_66]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_67]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_68]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_69]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = NewObject layout=[[L_70]]
// CHECK-NEXT: v6 = NewClosure v2 function=[[f_71]]
// CHECK-NEXT: DefineGetter v5, v6 key="back"
// CHECK-NEXT: v8 = FinishObject v5
// CHECK-NEXT: PropSet v2, v8 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeAssign"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_72]]}] results=[{type=undefined|null|[[L_2]] site=[[w_73]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_74]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_75]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Data data=[[d_76]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] site=[[w_77]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v7 = Data data=[[d_78]]
// CHECK-NEXT: v8 = Convert v2 declared={type=undefined|null|false|[[L_2]] flags=[OmitsUndefined]}
// CHECK-NEXT: v9 = NewObject -, v8 layout=[[L_8]] fields=[0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Call v6, v5, v7, v10 calleeName="Object.assign"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_8]] site=[[w_79]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v2, v12 key="k0"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_80]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_81]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_81]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_81]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_82]]
// CHECK-NEXT: PropSet v4, v1 key="back"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] captures=[{type=undefined|null|[[L_2]] site=[[w_83]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=undefined|null|[[L_2]] site=[[w_84]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_85]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] site=[[w_84]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_43]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[L_2]] site=[[w_86]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: env [[L_43]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_43]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="made"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_2]] site=[[w_86]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="n"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsChecked, HasExplicitName] length=1 captures=[{type=undefined|null|[[L_2]] site=[[w_52]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} parameters=[{type=number site=[[w_87]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_88]]}
// CHECK-NEXT: PropSet v0, v2 key="n"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=undefined|null|[[L_2]] site=[[w_89]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=undefined|null|[[L_2]] site=[[w_90]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_91]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] site=[[w_90]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="back"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] captures=[{type=undefined|null|[[L_2]] site=[[w_67]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=undefined|null|[[L_2]] site=[[w_92]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] site=[[w_92]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
