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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|ArrayBuffer|SharedArrayBuffer):
// CHECK-NEXT: v1 = PropGet v0 key=@@toStringTag
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kindOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|ArrayBuffer|SharedArrayBuffer):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="SharedArrayBuffer" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(SharedArrayBuffer) flags=[IsExpected]}
// CHECK-NEXT: v4 = InstanceOf v0, v3
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = String string="shared growable="
// CHECK-NEXT: v8 = PropGet v0 key="growable"
// CHECK-NEXT: v9 = ToString v8
// CHECK-NEXT: v10 = Strcat v7, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = String string="unshared resizable="
// CHECK-NEXT: v14 = PropGet v0 key="resizable"
// CHECK-NEXT: v15 = ToString v14
// CHECK-NEXT: v16 = String string=" detached="
// CHECK-NEXT: v17 = PropGet v0 key="detached"
// CHECK-NEXT: v18 = ToString v17
// CHECK-NEXT: v19 = Strcat v13, v15, v16, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tailOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|ArrayBuffer|SharedArrayBuffer):
// CHECK-NEXT: v1 = PropGet v0 key="slice"
// CHECK-NEXT: v2 = Integer integer=4
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="slice" calleeName="buffer.slice"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|ArrayBuffer|SharedArrayBuffer flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|ArrayBuffer|SharedArrayBuffer flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="firstByte"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|ArrayBuffer|SharedArrayBuffer flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|ArrayBuffer|SharedArrayBuffer):
// CHECK-NEXT: v1 = Builtin builtin=Uint8Array
// CHECK-NEXT: v2 = Construct v1, -, v0 calleeName="Uint8Array"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Uint8Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = Call v5, -, v0 calleeName="sizeOf"
// CHECK-NEXT: ElemSet v3, v4, v6
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="DataView" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(DataView) flags=[IsExpected]}
// CHECK-NEXT: v11 = Construct v10, -, v0 calleeName="DataView"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|DataView flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = PropGet v12 key="getUint8"
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="getUint8" calleeName="getUint8"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=number}}, {declared={type=number}}]
// CHECK-NEXT: }
