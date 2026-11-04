// RUN: lower
// OPTIONS: builtin-modules

// The return type of each getter hangs on the type of `this`, which is the literal that holds the getter: under a computed key, and beside a property of the getter's name.
const describe: any = (...values: unknown[]) => values.map(value => typeof value).join(" ");
const key: any = "computed";
const index: any = 3;

const underComputedKey = {
  // @ts-ignore
  get [key]() {
    return describe(this as any, 1);
  },
};

const underComputedIndex = {
  first: "first",
  // @ts-ignore
  get [index]() {
    let result;
    try {
      result = describe(this as any, this.first);
    } catch (error) {}
    return result;
  },
};

const besideAProperty = {
  // @ts-ignore
  size: 1227,
  // @ts-ignore
  get size() {
    let made;
    try {
      made = new (Proxy as any)(ArrayBuffer as any, {} as any, this as any);
    } catch (error) {}
    return made;
  },
};

const withSetter = {
  stored: [] as unknown[],
  // @ts-ignore
  get [key]() {
    return describe(this, this.stored.length);
  },
  // @ts-ignore
  set [key](value) {
    this.stored.push(value);
  },
};

const nested = {
  // @ts-ignore
  get [key]() {
    const inner = {
      // @ts-ignore
      get [key]() {
        return describe(this as any);
      },
    };
    return describe(this as any, inner[key]);
  },
};

console.log(underComputedKey[key], Object.keys(underComputedKey));
console.log(underComputedIndex[index], Object.keys(underComputedIndex));
console.log(
  typeof besideAProperty.size,
  besideAProperty.size === ArrayBuffer,
  Object.getOwnPropertyDescriptor(besideAProperty, "size")!.get !== undefined,
);
withSetter[key] = "a";
withSetter[key] = 2;
console.log(withSetter[key], withSetter.stored);
console.log(nested[key]);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_2]]
// CHECK-NEXT: v2 = String string="computed"
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_3]]
// CHECK-NEXT: v4 = Integer integer=3
// CHECK-NEXT: v5 = NewDictionary
// CHECK-NEXT: v6 = ToPropertyKey v2
// CHECK-NEXT: v7 = NewClosure function=[[f_4]]
// CHECK-NEXT: SetFunctionName v7, v6 methodKind=Getter
// CHECK-NEXT: DefineGetter v5, v7, v6
// CHECK-NEXT: v10 = String string="first"
// CHECK-NEXT: v11 = ToPropertyKey v4
// CHECK-NEXT: v12 = NewObject -, v10 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v13 = NewClosure function=[[f_6]]
// CHECK-NEXT: SetFunctionName v13, v11 methodKind=Getter
// CHECK-NEXT: DefineGetter v12, v13, v11
// CHECK-NEXT: v16 = FinishObject v12
// CHECK-NEXT: v17 = Integer integer=1227
// CHECK-NEXT: v18 = NewObject -, v17 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v19 = NewClosure function=[[f_8]]
// CHECK-NEXT: DefineGetter v18, v19 key="size"
// CHECK-NEXT: v21 = FinishObject v18
// CHECK-NEXT: v22 = Data data=[[d_9]]
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v24 = ToPropertyKey v2
// CHECK-NEXT: v25 = NewObject -, v23 layout=[[L_10]] fields=[0]
// CHECK-NEXT: v26 = NewClosure function=[[f_11]]
// CHECK-NEXT: SetFunctionName v26, v24 methodKind=Getter
// CHECK-NEXT: DefineGetter v25, v26, v24
// CHECK-NEXT: v29 = ToPropertyKey v2
// CHECK-NEXT: v30 = NewClosure function=[[f_12]]
// CHECK-NEXT: SetFunctionName v30, v29 methodKind=Setter
// CHECK-NEXT: DefineSetter v25, v30, v29
// CHECK-NEXT: v33 = FinishObject v25
// CHECK-NEXT: v34 = NewDictionary
// CHECK-NEXT: v35 = ToPropertyKey v2
// CHECK-NEXT: v36 = NewClosure function=[[f_13]]
// CHECK-NEXT: SetFunctionName v36, v35 methodKind=Getter
// CHECK-NEXT: DefineGetter v34, v36, v35
// CHECK-NEXT: v39 = Builtin builtin=GlobalThis
// CHECK-NEXT: v40 = PropGet v39 key="console" [isFreeName]
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v42 = PropGet v41 key="log"
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v5 key="computed"
// CHECK-NEXT: v45 = Builtin builtin=Object
// CHECK-NEXT: v46 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v47 = Call v46, v45, v5 calleeName="Object.keys"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v49 = Call v43, v41, v44, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Builtin builtin=GlobalThis
// CHECK-NEXT: v51 = PropGet v50 key="console" [isFreeName]
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v52 key="log"
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v55 = Integer integer=3
// CHECK-NEXT: v56 = ElemGet v16, v55
// CHECK-NEXT: v57 = Builtin builtin=Object
// CHECK-NEXT: v58 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v59 = Call v58, v57, v16 calleeName="Object.keys"
// CHECK-NEXT: v60 = Convert v59 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v61 = Call v54, v52, v56, v60 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v62 = Builtin builtin=GlobalThis
// CHECK-NEXT: v63 = PropGet v62 key="console" [isFreeName]
// CHECK-NEXT: v64 = Convert v63 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v65 = PropGet v64 key="log"
// CHECK-NEXT: v66 = Convert v65 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v67 = PropGet v21 key="size"
// CHECK-NEXT: v68 = TypeOf v67
// CHECK-NEXT: v69 = PropGet v21 key="size"
// CHECK-NEXT: v70 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v71 = StrictEq v69, v70
// CHECK-NEXT: v72 = Builtin builtin=Object
// CHECK-NEXT: v73 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v74 = String string="size"
// CHECK-NEXT: v75 = Call v73, v72, v21, v74 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v76 = Convert v75 declared={type=undefined|null|number|string|symbol|bigint|[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: v77 = PropGet v76 key="get"
// CHECK-NEXT: v78 = TypeTest v77 testedType=undefined
// CHECK-NEXT: v79 = LogicalNot v78
// CHECK-NEXT: v80 = Call v66, v64, v68, v71, v79 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v81 = String string="a"
// CHECK-NEXT: PropSet v33, v81 key="computed"
// CHECK-NEXT: v83 = Integer integer=2
// CHECK-NEXT: PropSet v33, v83 key="computed"
// CHECK-NEXT: v85 = Builtin builtin=GlobalThis
// CHECK-NEXT: v86 = PropGet v85 key="console" [isFreeName]
// CHECK-NEXT: v87 = Convert v86 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v88 = PropGet v87 key="log"
// CHECK-NEXT: v89 = Convert v88 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v90 = PropGet v33 key="computed"
// CHECK-NEXT: v91 = PropGet v33 key="stored"
// CHECK-NEXT: v92 = Call v89, v87, v90, v91 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v93 = Builtin builtin=GlobalThis
// CHECK-NEXT: v94 = PropGet v93 key="console" [isFreeName]
// CHECK-NEXT: v95 = Convert v94 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v96 = PropGet v95 key="log"
// CHECK-NEXT: v97 = Convert v96 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v98 = PropGet v34 key="computed"
// CHECK-NEXT: v99 = Call v97, v95, v98 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v100 = Undefined
// CHECK-NEXT: Return v100
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: v1 = PropGet v0 key="map"
// CHECK-NEXT: v2 = NewClosure function=[[f_15]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="describe"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Call v2, -, v0, v3 calleeName="describe"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b3(v1):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="describe"
// CHECK-NEXT: v4 = PropGet v0 key="first"
// CHECK-NEXT: v5 = Call v3, -, v0, v4 calleeName="describe"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3(v5):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b3(v6) role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b3(v1):
// CHECK-NEXT: v2 = Builtin builtin=Proxy
// CHECK-NEXT: v3 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v4 = Data data=[[d_16]]
// CHECK-NEXT: v5 = Construct v2, -, v3, v4, v0 calleeName="Proxy"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3(v5):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b3(v6) role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="describe"
// CHECK-NEXT: v3 = PropGet v0 key="stored"
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = Call v2, -, v0, v4 calleeName="describe"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="stored"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeKey="push" calleeName="this.stored.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewDictionary
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="key"
// CHECK-NEXT: v4 = ToPropertyKey v3
// CHECK-NEXT: v5 = NewClosure function=[[f_17]]
// CHECK-NEXT: SetFunctionName v5, v4 methodKind=Getter
// CHECK-NEXT: DefineGetter v1, v5, v4
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="describe"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="key"
// CHECK-NEXT: v12 = PropGet v1 key="computed"
// CHECK-NEXT: v13 = Call v9, -, v0, v12 calleeName="describe"
// CHECK-NEXT: ReturnCall v13
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="describe"
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="describe"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
