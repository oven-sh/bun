// RUN: lower
// OPTIONS: builtin-modules

// An array with an accessor for an element, with an own property that hides a built-in method, or with another prototype is still an array to the functions of the runtime that take one.
import { closeSync, openSync, readFileSync, readvSync, rmSync, writevSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const file = join(tmpdir(), `arrays-handed-to-the-runtime-${process.pid}.bin`);
const first = new Uint8Array(4).fill(0x41);
const second = new Uint8Array(2).fill(0x42);
const row = (name: string, f: () => unknown) => {
  let r: unknown;
  try {
    r = f();
  } catch (e) {
    r = "THROWS " + (e as Error).message;
  }
  console.log(name + ": " + JSON.stringify(r));
};
function withAccessor<T>(head: T, tail: T): T[] {
  const array: T[] = [head];
  Object.defineProperty(array, 1, { enumerable: true, configurable: true, get: () => tail });
  return array;
}
function withOwnMethod<T>(...items: T[]): T[] {
  const array: T[] = [...items];
  Object.defineProperty(array, "push", { value: () => 0, configurable: true, writable: true });
  return array;
}
function withOtherPrototype<T>(...items: T[]): T[] {
  const array: T[] = [...items];
  Object.setPrototypeOf(array, Object.create(Array.prototype));
  return array;
}
function written(buffers: Uint8Array[]) {
  const fd = openSync(file, "w");
  try {
    return [writevSync(fd, buffers), readFileSync(file, "latin1")];
  } finally {
    closeSync(fd);
  }
}
function read(buffers: Uint8Array[]) {
  const fd = openSync(file, "r");
  try {
    return [readvSync(fd, buffers), buffers.length];
  } finally {
    closeSync(fd);
  }
}
row("writevSync, as made", () => written([first, second]));
row("writevSync, an accessor", () => written(withAccessor(first, second)));
row("writevSync, an own method", () => written(withOwnMethod(first, second)));
row("writevSync, another prototype", () => written(withOtherPrototype(first, second)));
row("readvSync, an accessor", () => read(withAccessor(new Uint8Array(4), new Uint8Array(2))));
row("readvSync, an own method", () => read(withOwnMethod(new Uint8Array(4), new Uint8Array(2))));
row("Buffer.concat, an accessor", () => Buffer.concat(withAccessor(first, second)).toString("latin1"));
row("Buffer.from, an own method", () => Buffer.from(withOwnMethod(65, 66)).toString("latin1"));
row("Buffer.from, an accessor", () => Buffer.from(withAccessor(65, 66)).toString("latin1"));
row("emitWarning, an own method", () => process.emitWarning("w", withOwnMethod("a") as any));
row("emitWarning, as made", () => process.emitWarning("w", ["a"] as any));
row("Blob, an accessor", () => new Blob(withAccessor("a", "b")).size);
row("Blob, an own method", () => new Blob(withOwnMethod("a", "b")).size);
row("tls, as made", () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, tls: { ca: ["x"] } }).stop());
row("tls, an own method", () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, tls: { ca: withOwnMethod("x") } }).stop());
row("tls, an accessor", () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, tls: { ca: withAccessor("x", "y") } }).stop());
row("spawnSync, an own method", () => Bun.spawnSync(withOwnMethod("/bin/echo", "said")).stdout.toString());
row("spawnSync, an accessor", () => Bun.spawnSync(withAccessor("/bin/echo", "said")).stdout.toString());
row("structuredClone, an own method", () => structuredClone(withOtherPrototype(1, 2)));
row("inspect", () => [Bun.inspect(withOwnMethod(1, 2)), Bun.inspect(withOtherPrototype(1, 2)), Bun.inspect(withAccessor(1, 2))]);
row("deepEquals", () => [Bun.deepEquals(withOtherPrototype(1, 2), [1, 2]), Bun.deepEquals(withAccessor(1, 2), [1, 2])]);
row("JSON", () => [withOwnMethod(1, 2), withOtherPrototype(1, 2), withAccessor(1, 2)]);
rmSync(file, { force: true });

// GENERATED: withAccessor withOtherPrototype read get
// CHECK-LABEL: function {{*}}name="withAccessor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = NewArray v0 contents=anything
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|boolean}
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|boolean}
// CHECK-NEXT: v11 = NewClosure v1 function=[[f_1]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v13 = NewObject -, v8, v10 layout=[[L_3]] fields=[1, 0]
// CHECK-NEXT: PropDefine v13, v12 key="get"
// CHECK-NEXT: v15 = FinishObject v13
// CHECK-NEXT: v16 = Call v5, v4, v3, v6, v15 calleeName="Object.defineProperty"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="withOtherPrototype"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: v1 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v1, v0
// CHECK-NEXT: v3 = Convert v1 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectSetPrototypeOf
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v8 = Builtin builtin=ArrayPrototype
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeName="Object.create"
// CHECK-NEXT: v10 = Call v5, v4, v3, v9 calleeName="Object.setPrototypeOf"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|Uint8Array> flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|Uint8Array>):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="openSync"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(NodeFsOpenSync) flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="file"
// CHECK-NEXT: v6 = String string="r"
// CHECK-NEXT: v7 = Call v3, -, v5, v6 calleeName="openSync"
// CHECK-NEXT: v8 = Convert v7 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b3():
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="readvSync"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(NodeFsReadvSync) flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, -, v8, v0 calleeName="readvSync"
// CHECK-NEXT: v13 = Convert v12 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = PropGet v0 key="length"
// CHECK-NEXT: v15 = NewArray v13, v14 contents=anything
// CHECK-NEXT: Jump -> next b2(v15)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: v17 = Integer
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Jump -> next b4(v17, v16, v18)
// CHECK-NEXT: b3() role=CleanupHandler:
// CHECK-NEXT: v19 = CatchValue
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Jump -> next b4(v20, v21, v19)
// CHECK-NEXT: b4(v22, v23, v24):
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="closeSync"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(NodeFsCloseSync) flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v27, -, v8 calleeName="closeSync"
// CHECK-NEXT: Switch v22 cases=[0] -> case b5(), otherwise b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v23
// CHECK-NEXT: b6():
// CHECK-NEXT: Throw v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=anything variableName="tail"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
