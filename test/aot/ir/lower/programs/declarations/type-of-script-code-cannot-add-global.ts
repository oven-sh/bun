// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// `Node` and `Event` are interfaces and variables of the library, so a type alias or a class of that name is a duplicate in a script, and `status` is a variable of another type there. A build runs the file as a module, where such a name is the file's own.
type Node = { own: number; next: Node | null };
declare class Event {
  constructor(label: number);
  label: number;
}
declare var status: number | undefined;
const node: Node = { own: 1, next: { own: 2, next: null } };
function labelOf(event: Event): number {
  return event.label;
}
function orZero(value: number | undefined): number {
  return value ?? 0;
}
console.log(node.own + node.next!.own, labelOf({ label: 3 }), typeof status === "undefined" ? "none" : orZero(status));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "auto", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [ "main.ts" ] }

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
// CHECK-NEXT: v4 = Data data=[[d_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v5 key="own"
// CHECK-NEXT: v12 = PropGet v5 key="next"
// CHECK-NEXT: v13 = PropGet v12 key="own"
// CHECK-NEXT: v14 = Add v11, v13
// CHECK-NEXT: v15 = Data data=[[d_6]]
// CHECK-NEXT: v16 = Call v1, -, v15 calleeName="labelOf"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_7]]}
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="status" [isFreeName, isForTypeOf]
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined
// CHECK-NEXT: Branch v20 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v21):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v22 = String string="none"
// CHECK-NEXT: Jump -> next b6(v22)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="status" [isFreeName]
// CHECK-NEXT: v26 = Call v3, -, v25 calleeName="orZero"
// CHECK-NEXT: v27 = Convert v26 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Jump -> next b6(v27)
// CHECK-NEXT: b6(v28):
// CHECK-NEXT: v29 = Call v10, v8, v14, v17, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="labelOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="label"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="orZero"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|number site=[[w_12]]}] results=[{type=number site=[[w_13]]}] {
// CHECK-NEXT: b0(v0: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: Jump -> next b5(v3)
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b5(v5):
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
