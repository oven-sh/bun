// RUN: lower
// OPTIONS: builtin-modules

// An ArrayBuffer and a SharedArrayBuffer are cells of one kind in the engine, and each class has getters and methods of its own: a member of a value that may be either comes from the class of the value.
type AnyBuffer = ArrayBuffer | SharedArrayBuffer;
function sizeOf(buffer: AnyBuffer): number { return buffer.byteLength; }
function limitOf(buffer: AnyBuffer): number { return buffer.maxByteLength; }
function tailOf(buffer: AnyBuffer): AnyBuffer { return buffer.slice(4); }
function tagOf(buffer: AnyBuffer): string { return buffer[Symbol.toStringTag]; }
function kindOf(buffer: AnyBuffer): string {
  if (buffer instanceof SharedArrayBuffer) return `shared growable=${buffer.growable}`;
  return `unshared resizable=${buffer.resizable} detached=${buffer.detached}`;
}
function describe(value: AnyBuffer | Uint8Array | string | undefined): string {
  if (value === undefined) return "nothing";
  if (typeof value === "string") return `text ${value.length}`;
  if (value instanceof Uint8Array) return `view ${value.length} over ${kindOf(value.buffer)}`;
  return `${tagOf(value)} ${sizeOf(value)}`;
}
function firstByte(buffer: AnyBuffer): number {
  const bytes = new Uint8Array(buffer);
  bytes[0] = sizeOf(buffer);
  return new DataView(buffer).getUint8(0);
}
const buffers: AnyBuffer[] = [new ArrayBuffer(8), new SharedArrayBuffer(16), new ArrayBuffer(24, { maxByteLength: 32 }), new SharedArrayBuffer(40, { maxByteLength: 64 })];
for (let round = 0; round < 3; round++) {
  for (const buffer of buffers) console.log(round, sizeOf(buffer), limitOf(buffer), sizeOf(tailOf(buffer)), tagOf(buffer), tagOf(tailOf(buffer)), kindOf(buffer), firstByte(buffer));
}
for (const value of [buffers[0], buffers[1], new Uint8Array(buffers[0]), new Uint8Array(buffers[1]), "text", undefined]) console.log(describe(value));
const moved = new ArrayBuffer(8);
const target = moved.transfer(4);
console.log(kindOf(moved), sizeOf(moved), kindOf(target), sizeOf(target));

// GENERATED: tagOf kindOf tailOf firstByte
// CHECK-LABEL: function {{*}}name="tagOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|ArrayBuffer|SharedArrayBuffer):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key=@@toStringTag
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kindOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|ArrayBuffer|SharedArrayBuffer):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="SharedArrayBuffer" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(SharedArrayBuffer) flags=[IsExpected]}
// CHECK-NEXT: v4 = InstanceOf v0, v3 writtenExpression="buffer instanceof SharedArrayBuffer"
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = String string="shared growable="
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|SharedArrayBuffer} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v8 key="growable"
// CHECK-NEXT: v10 = Convert v9 declared={type=boolean site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = ToString v10
// CHECK-NEXT: v12 = Strcat v7, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = String string="unshared resizable="
// CHECK-NEXT: v16 = Convert v0 declared={type=undefined|null|ArrayBuffer} illTypedCause=Assertion
// CHECK-NEXT: v17 = PropGet v16 key="resizable"
// CHECK-NEXT: v18 = Convert v17 declared={type=boolean site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = ToString v18
// CHECK-NEXT: v20 = String string=" detached="
// CHECK-NEXT: v21 = PropGet v16 key="detached"
// CHECK-NEXT: v22 = Convert v21 declared={type=boolean site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v23 = ToString v22
// CHECK-NEXT: v24 = Strcat v15, v19, v20, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tailOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|ArrayBuffer|SharedArrayBuffer):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="slice"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_10]]|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=4
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="slice" calleeName="buffer.slice"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|ArrayBuffer|SharedArrayBuffer site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|ArrayBuffer|SharedArrayBuffer site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="firstByte"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: undefined|null|ArrayBuffer|SharedArrayBuffer):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Uint8Array
// CHECK-NEXT: v2 = Construct v1, -, v0 calleeName="Uint8Array"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Uint8Array site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v6 = Call v5, -, v0 calleeName="sizeOf"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_17]]}
// CHECK-NEXT: ElemSet v3, v4, v7
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="DataView" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(DataView) flags=[IsExpected]}
// CHECK-NEXT: v12 = Construct v11, -, v0 calleeName="DataView"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|DataView site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = PropGet v13 key="getUint8"
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="getUint8" calleeName="getUint8"
// CHECK-NEXT: ReturnCall v16 casts=[{declared={type=number site=[[w_18]]}}, {declared={type=number site=[[w_14]]}}]
// CHECK-NEXT: }
