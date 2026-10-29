// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// With noUnusedLocals and noUnusedParameters, a name whose only use is in code that the build removes is not reported as unused.
const WINDOWS_PATH = /^[a-zA-Z]:/;
type Drive = string;
class Paths {
  private separator = "\\";
  #root = "C:";
  isAbsolute(path: string): boolean {
    if (process.platform === "win32") {
      const drive: Drive = this.#root + this.separator;
      return WINDOWS_PATH.test(path) || path.startsWith(drive);
    }
    return path.startsWith("/");
  }
}
function decode(text: string, onError: (message: string) => void): string {
  if (typeof Buffer === "function") return Buffer.from(text, "base64").toString();
  onError("no Buffer");
  return text;
}
const separator = process.platform === "win32" ? WINDOWS_PATH.source : "/";
console.log(new Paths().isAbsolute("/a"), decode("YQ==", message => console.log(message)), separator);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "noUnusedLocals": true, "noUnusedParameters": true }, "files": [] }

// GENERATED: decode Paths isAbsolute
// CHECK-LABEL: function {{*}}name="decode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Buffer" [isFreeName, isForTypeOf]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v5 = TypeTest v4 testedType=function
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="Buffer" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="from"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="base64"
// CHECK-NEXT: v13 = Call v11, v9, v0, v12 calleeKey="from" calleeName="Buffer.from"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Buffer site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = PropGet v14 key="toString"
// CHECK-NEXT: v16 = Call v15, v14 calleeKey="toString" calleeName="toString"
// CHECK-NEXT: ReturnCall v16 casts=[{declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = String string="no Buffer"
// CHECK-NEXT: v19 = Call v1, -, v18 calleeName="onError"
// CHECK-NEXT: v20 = Convert v0 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Paths"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_7]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isAbsolute"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_6]] site=[[w_8]]} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: [[L_6]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Process
// CHECK-NEXT: v3 = PropGet v2 key="platform"
// CHECK-NEXT: v4 = String string="win32"
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b7()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v7 = PrivateGet v0, v6 layout=[[L_6]] field=2
// CHECK-NEXT: v8 = PropGet v0 key="separator"
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="WINDOWS_PATH"
// CHECK-NEXT: v13 = PropGet v12 key="test"
// CHECK-NEXT: v14 = Call v13, v12, v1 calleeKey="test" calleeName="WINDOWS_PATH.test"
// CHECK-NEXT: v15 = Convert v14 declared={type=boolean site=[[w_14]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = ToBoolean v15
// CHECK-NEXT: Branch v16 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = Convert v17 declared={type=boolean site=[[w_10]]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v20 = PropGet v1 key="startsWith"
// CHECK-NEXT: v21 = Call v20, v1, v10 calleeKey="startsWith" calleeName="path.startsWith"
// CHECK-NEXT: ReturnCall v21 casts=[{declared={type=boolean site=[[w_15]]}}, {declared={type=boolean site=[[w_10]]}}]
// CHECK-NEXT: b7():
// CHECK-NEXT: v22 = PropGet v1 key="startsWith"
// CHECK-NEXT: v23 = String string="/"
// CHECK-NEXT: v24 = Call v22, v1, v23 calleeKey="startsWith" calleeName="path.startsWith"
// CHECK-NEXT: ReturnCall v24 casts=[{declared={type=boolean site=[[w_16]]}}, {declared={type=boolean site=[[w_10]]}}]
// CHECK-NEXT: }
