// RUN: lower
// OPTIONS: builtin-modules

// Only promise all calls the overridden resolve.
const log: string[] = [];

class Tracked<T> extends Promise<T> {
  static resolve(): Promise<void>;
  static resolve<T>(value: T): Promise<Awaited<T>>;
  static resolve<T>(value?: T): Promise<Awaited<T> | void> {
    log.push("resolve " + String(value));
    return super.resolve(value);
  }
}

console.log((await Tracked.all([1, 2])).join() + " [" + log.join(", ") + "]");

export {};

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|string> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_3]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="Promise" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v6 = ResolveHeritage v5
// CHECK-NEXT: v7 = NewClosure function=[[f_4]]
// CHECK-NEXT: v8 = NewClass v7, v5, v6 layout=[[L_5]]
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_6]]
// CHECK-NEXT: v10 = NewClosure function=[[f_7]]
// CHECK-NEXT: DefineMethod v8, v10 layout=[[L_5]] side=Static key="resolve"
// CHECK-NEXT: v12 = FinishClass v8 layout=[[L_5]]
// CHECK-NEXT: v13 = Convert v12 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = Convert v12 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v14 key="all"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(PromiseAll) flags=[IsExpected]}
// CHECK-NEXT: v22 = Data data=[[d_8]]
// CHECK-NEXT: v23 = Call v21, v14, v22 calleeKey="all" calleeName="Tracked.all"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Promise<undefined|null|Array<number>> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v25 = Await v24
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<number> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v27 = PropGet v26 key="join"
// CHECK-NEXT: v28 = Call v27, v26 calleeKey="join" calleeName="join"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v30 = String string=" ["
// CHECK-NEXT: v31 = Add v29, v30
// CHECK-NEXT: v32 = PropGet v1 key="join"
// CHECK-NEXT: v33 = String string=", "
// CHECK-NEXT: v34 = Call v32, v1, v33 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v36 = Add v31, v35
// CHECK-NEXT: v37 = String string="]"
// CHECK-NEXT: v38 = Add v36, v37
// CHECK-NEXT: v39 = Call v19, v17, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Tracked"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="resolve"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=function flags=[IsExpected]} parameters=[{type=undefined|null|[[L_12]] site=[[w_13]]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: function, v1: undefined|null|[[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="resolve "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v6, -, v1 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Add v5, v8
// CHECK-NEXT: v10 = Call v4, v3, v9 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v13 = GetSuperBase v12
// CHECK-NEXT: v14 = SuperGet v13, v0 key="resolve"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v0, v1 calleeName="super.resolve"
// CHECK-NEXT: ReturnCall v16 casts=[{declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
