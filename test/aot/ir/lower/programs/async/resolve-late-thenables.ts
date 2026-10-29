// RUN: lower
// OPTIONS: builtin-modules

// An async function's result and an awaited value are adopted through `then` once the object or its prototype chain has one, and pass through unchanged otherwise.
const log: string[] = [];

type Resolve = (value: unknown) => void;
type Then = (resolve: Resolve) => void;

class Account {
  constructor(public id: number) {}
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
class Shape {
  constructor(public sides: number) {}
}
interface Download {
  url: string;
  then?: Then;
}
interface Upload {
  path: string;
  then?: unknown;
}
interface Settings {
  depth: number;
  label: string;
}

const returnAccount = async (account: Account): Promise<unknown> => account;
const awaitAccount = async (account: Account): Promise<unknown> => await account;
const returnDownload = async (download: Download): Promise<unknown> => download as unknown;
const awaitDownload = async (download: Download): Promise<unknown> => await (download as unknown);
const returnUpload = async (upload: Upload): Promise<unknown> => upload;
const awaitUpload = async (upload: Upload): Promise<unknown> => await upload;
const returnPoint = async (point: Point): Promise<unknown> => point;
const awaitPoint = async (point: Point): Promise<unknown> => await point;
const returnShape = async (shape: Shape): Promise<unknown> => shape;
const awaitShape = async (shape: Shape): Promise<unknown> => await shape;
const returnSettings = async (settings: Settings): Promise<unknown> => settings;
const awaitSettings = async (settings: Settings): Promise<unknown> => await settings;
const returnList = async (list: number[]): Promise<unknown> => list;
const awaitList = async (list: number[]): Promise<unknown> => await list;
const returnTable = async (table: Map<string, number>): Promise<unknown> => table;
const awaitTable = async (table: Map<string, number>): Promise<unknown> => await table;

function describe(value: unknown): string {
  if (value instanceof Map) return `Map(${value.size})`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function adopt(label: string): Then {
  return resolve => {
    log.push(`then of ${label}`);
    resolve(`adopted from ${label}`);
  };
}

async function observe(label: string, returned: Promise<unknown>, awaited: Promise<unknown>): Promise<void> {
  returned.then(value => log.push(`${label}: returned ${describe(value)}`));
  awaited.then(value => log.push(`${label}: awaited ${describe(value)}`));
  for (let turn = 1; turn <= 4; turn++) {
    await undefined;
    log.push(`${label}: turn ${turn}`);
  }
}

async function classInstances(): Promise<void> {
  const first = new Account(1);
  await observe("instance", returnAccount(first), awaitAccount(first));
  (Account.prototype as any).then = function (this: Account, resolve: Resolve): void {
    log.push(`then of account ${this.id}`);
    resolve(`adopted from account ${this.id}`);
  };
  const second = new Account(2);
  await observe("instance created after the class gained then", returnAccount(second), awaitAccount(second));
  await observe("instance created before the class gained then", returnAccount(first), awaitAccount(first));
  delete (Account.prototype as any).then;
  await observe("instance after the class lost then", returnAccount(second), awaitAccount(second));
}

async function optionalFields(): Promise<void> {
  const plainDownload: Download = { url: "a" };
  const thenableDownload: Download = { url: "b", then: adopt("download b") };
  await observe("absent field, first of its type", returnDownload(plainDownload), awaitDownload(plainDownload));
  await observe("present field, second of its type", returnDownload(thenableDownload), awaitDownload(thenableDownload));
  plainDownload.then = adopt("download a");
  await observe("field assigned later", returnDownload(plainDownload), awaitDownload(plainDownload));

  const thenableUpload: Upload = { path: "c", then: adopt("upload c") };
  const plainUpload: Upload = { path: "d" };
  await observe("present field, first of its type", returnUpload(thenableUpload), awaitUpload(thenableUpload));
  await observe("absent field, second of its type", returnUpload(plainUpload), awaitUpload(plainUpload));
}

async function extraProperties(): Promise<void> {
  const point = new Point(1, 2);
  await observe("instance without extra properties", returnPoint(point), awaitPoint(point));
  (point as any).then = adopt("point");
  await observe("instance with an extra then", returnPoint(point), awaitPoint(point));
  const sibling = new Point(3, 4);
  await observe("sibling without extra properties", returnPoint(sibling), awaitPoint(sibling));
  (sibling as any).label = "sibling";
  await observe("sibling with another extra property", returnPoint(sibling), awaitPoint(sibling));
  delete (point as any).then;
  await observe("instance after its extra then is deleted", returnPoint(point), awaitPoint(point));
}

async function createdPrototypes(): Promise<void> {
  const root = Object.create(Object.prototype);
  Object.setPrototypeOf(Shape.prototype, Object.create(root));
  const shape = new Shape(3);
  await observe("created objects on the chain", returnShape(shape), awaitShape(shape));
  root.then = adopt("created prototype");
  await observe("created prototype with then", returnShape(shape), awaitShape(shape));
  delete root.then;
  await observe("created prototype after then is deleted", returnShape(shape), awaitShape(shape));

  const derived: Shape = Object.create(shape);
  await observe("object created from an instance", returnShape(derived), awaitShape(derived));
  (shape as any).then = adopt("instance used as a prototype");
  await observe("object created from a thenable instance", returnShape(derived), awaitShape(derived));
}

async function plainData(): Promise<void> {
  const settings: Settings = { depth: 2, label: "plain" };
  await observe("data object", returnSettings(settings), awaitSettings(settings));
  const list = [1, 2, 3];
  await observe("array", returnList(list), awaitList(list));
  const table = new Map([["one", 1]]);
  await observe("map", returnTable(table), awaitTable(table));
}

async function main(): Promise<void> {
  await classInstances();
  await optionalFields();
  await extraProperties();
  await createdPrototypes();
  await plainData();
  console.log(log.join("\n"));
}

main();

export {};

// GENERATED: observe Account returnList awaitTable
// CHECK-LABEL: function {{*}}name="observe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|Promise, v3: undefined|null|Promise):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = PropGet v2 key="then"
// CHECK-NEXT: v5 = NewClosure v1 function=[[f_2]]
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="then" calleeName="returned.then"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v3 key="then"
// CHECK-NEXT: v9 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v10 = Call v8, v3, v9 calleeKey="then" calleeName="awaited.then"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v13)
// CHECK-NEXT: b2(v14: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = Integer integer=4
// CHECK-NEXT: v17 = LessEq v14, v16
// CHECK-NEXT: Branch v17 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = Await v19, v1, v2, v3
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined site=[[w_5]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="log"
// CHECK-NEXT: v24 = PropGet v23 key="push"
// CHECK-NEXT: v25 = ToString v1
// CHECK-NEXT: v26 = String string=": turn "
// CHECK-NEXT: v27 = ToString v18
// CHECK-NEXT: v28 = Strcat v25, v26, v27
// CHECK-NEXT: v29 = Call v24, v23, v28 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v30 = Convert v29 declared={type=number site=[[w_7]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v31 = Increment v18
// CHECK-NEXT: v32 = Convert v31 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v32)
// CHECK-NEXT: b6(v33):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Account"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_8]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_9]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_10]]
// CHECK-NEXT: PropSet v4, v1 key="id"
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
// CHECK-LABEL: function {{*}}name="returnList"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="awaitTable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, number> site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Await v0, v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Map<undefined|null|string, number> site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
