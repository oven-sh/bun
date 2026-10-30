// RUN: lower
// OPTIONS: builtin-modules

// A CommonJS TypeScript file: the functions outside the class bodies are sloppy code, and the fields are declared all the same.
// A first store into an instance that is frozen, sealed or not extensible does nothing, says nothing, and must not fill the slot.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Config {
  declare id: number;
  mode?: string;
  level?: number;
  constructor(id: number) {
    delete this.mode;
    delete this.level;
    handOver(this);
    this.id = id;
  }
  strictStore(value: string) {
    this.mode = value;
  }
}
interface Plain {
  id: number;
  mode?: string;
  level?: number;
}
function setMode(config: Config, value: string) {
  config.mode = value;
  return config.mode;
}
function setLevel(config: Config, value: number) {
  config.level = value;
  return config.level;
}
function setModeOfPlain(plain: Plain, value: string) {
  plain.mode = value;
  return plain.mode;
}
function orDefault(config: Config) {
  return (config.level ??= 5);
}
function bump(config: Config) {
  return config.level!++;
}
function state(object: Plain) {
  return `${object.mode} ${object.level} ${"mode" in object} ${Object.prototype.hasOwnProperty.call(object, "mode")} [${Object.keys(object)}] ${JSON.stringify(object)}`;
}
function strictly(config: Config) {
  try {
    config.strictStore("strict");
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
console.log("sloppy:", (function (this: unknown) { return this !== undefined; })());
const closers: [string, <T extends object>(object: T) => T][] = [
  ["open", object => object],
  ["frozen", Object.freeze],
  ["sealed", Object.seal],
  ["not extensible", Object.preventExtensions],
];

let count = 0;
for (let i = 0; i < 3000; i++) {
  const config = new Config(i);
  if (i % 5 === 0) Object.preventExtensions(config);
  if (setMode(config, "m") === undefined) count++;
  if (Object.keys(config).length === 2) count += 10;
}
console.log("warm", count);

for (const [label, close] of closers) {
  const empty = close(new Config(1));
  const half = new Config(2);
  setMode(half, "before");
  close(half);
  const literal = close<Plain>({ id: 3 });
  console.log(label);
  console.log("  empty:", setMode(empty, "a"), setLevel(empty, 1), orDefault(empty), bump(empty), "|", state(empty));
  console.log("  half:", setMode(half, "b"), setLevel(half, 2), delete half.mode, "|", state(half));
  console.log("  a literal:", setModeOfPlain(literal, "c"), "|", state(literal));
  console.log("  a method of the class is strict:", strictly(empty), "|", state(empty));
}

// GENERATED: bump state strictly Config
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="level"
// CHECK-NEXT: v2 = ToNumeric v1
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|number site=[[w_4]]}
// CHECK-NEXT: PropSet v0, v4 key="level" mode=Sloppy
// CHECK-NEXT: v6 = Convert v2 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="state"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="mode"
// CHECK-NEXT: v2 = ToString v1
// CHECK-NEXT: v3 = String string=" "
// CHECK-NEXT: v4 = PropGet v0 key="level"
// CHECK-NEXT: v5 = ToString v4
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = PropHas v0 key="mode"
// CHECK-NEXT: v8 = ToString v7
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = Builtin builtin=ObjectPrototypeHasOwnProperty
// CHECK-NEXT: v11 = PropGet v10 key="call"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v13 = String string="mode"
// CHECK-NEXT: v14 = Call v12, v10, v0, v13 calleeKey="call" calleeName="Object.prototype.hasOwnProperty.call"
// CHECK-NEXT: v15 = Convert v14 declared={type=boolean site=[[w_8]]} illTypedCause=FromLooseType
// CHECK-NEXT: v16 = ToString v15
// CHECK-NEXT: v17 = String string=" ["
// CHECK-NEXT: v18 = Builtin builtin=Object
// CHECK-NEXT: v19 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v20 = Call v19, v18, v0 calleeName="Object.keys"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<undefined|null|string> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = ToString v21
// CHECK-NEXT: v23 = String string="] "
// CHECK-NEXT: v24 = Builtin builtin=JSON
// CHECK-NEXT: v25 = PropGet v24 key="stringify"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v26, v24, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = ToString v28
// CHECK-NEXT: v30 = Strcat v2, v3, v5, v6, v8, v9, v16, v17, v22, v23, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="strictly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = PropGet v0 key="strictStore"
// CHECK-NEXT: v2 = String string="strict"
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="strictStore" calleeName="config.strictStore"
// CHECK-NEXT: v4 = String string="stored"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="constructor"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|function site=[[w_13]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = PropGet v9 key="name"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_13]]} illTypedCause=Assertion
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Config"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 captures=[{type=[[f_14]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=number site=[[w_15]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: [[f_14]], v1: anything, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v1 layout=[[L_1]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_16]]
// CHECK-NEXT: v7 = PropDelete v5 key="mode"
// CHECK-NEXT: v8 = PropDelete v5 key="level"
// CHECK-NEXT: v9 = Call v0, -, v5 calleeName="handOver"
// CHECK-NEXT: v10 = Convert v2 declared={type=number site=[[w_17]]}
// CHECK-NEXT: PropSet v5, v10 key="id"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = TypeTest v12 testedType=object
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
