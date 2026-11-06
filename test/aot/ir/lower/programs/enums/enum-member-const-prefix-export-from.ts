// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Plain Bun ends the prefix of inlined `const`s of a file where it parses `export { .. } from`, so a `const` above every other statement of such a file is a variable. The prefix of a function in the file is not affected.
const leading = 5;
function row(label: string, value: object) {
  console.log(label + ": " + Object.keys(value).map(key => key + "=" + String((value as any)[key])).join());
}

function reads() {
  const inner = 3;
  {
    enum E { Leading = leading, AfterLeading, Inner = inner, AfterInner }
    return E;
  }
}
row("a file that exports from another", reads());
export { shared } from "./shared";

// FILE: shared.ts
export const shared = 1;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer integer=5
// CHECK-NEXT: v5 = Convert v4 declared={type=5 site=[[w_3]]}
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_4]]
// CHECK-NEXT: v7 = String string="a file that exports from another"
// CHECK-NEXT: v8 = Call v3 calleeName="reads"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Call v1, -, v7, v9 calleeName="row"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|object site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v11 = Call v10, v9, v1 calleeName="Object.keys"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = PropGet v12 key="map"
// CHECK-NEXT: v14 = NewClosure v1 function=[[f_9]]
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="map" calleeName="map"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<undefined|null|string> site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = Call v17, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = Add v8, v19
// CHECK-NEXT: v21 = Call v6, v4, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reads"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|object site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=3
// CHECK-NEXT: v1 = Convert v0 declared={type=3 site=[[w_11]]}
// CHECK-NEXT: v2 = NewObject layout=[[L_12]]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="leading"
// CHECK-NEXT: PropSet v3, v5 key="Leading"
// CHECK-NEXT: v7 = ToPropertyKey v5
// CHECK-NEXT: v8 = String string="Leading"
// CHECK-NEXT: ElemSet v3, v7, v8
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: PropSet v3, v10 key="AfterLeading"
// CHECK-NEXT: v12 = String string="AfterLeading"
// CHECK-NEXT: PropSet v3, v12 key="undefined"
// CHECK-NEXT: v14 = Integer integer=3
// CHECK-NEXT: PropSet v3, v14 key="Inner"
// CHECK-NEXT: v16 = String string="Inner"
// CHECK-NEXT: ElemSet v3, v14, v16
// CHECK-NEXT: v18 = Integer integer=4
// CHECK-NEXT: PropSet v3, v18 key="AfterInner"
// CHECK-NEXT: v20 = String string="AfterInner"
// CHECK-NEXT: ElemSet v3, v18, v20
// CHECK-NEXT: v22 = Convert v3 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=undefined|null|object site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="="
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = ElemGet v5, v1
// CHECK-NEXT: v7 = Call v4, -, v6 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Add v3, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_17]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
