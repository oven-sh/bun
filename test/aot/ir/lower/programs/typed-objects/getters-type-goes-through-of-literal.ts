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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: v10 = Convert v5 declared={type=undefined|null|string|object site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = String string="first"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = ToPropertyKey v4
// CHECK-NEXT: v14 = NewObject -, v12 layout=[[L_6]] fields=[0]
// CHECK-NEXT: v15 = NewClosure function=[[f_7]]
// CHECK-NEXT: SetFunctionName v15, v13 methodKind=Getter
// CHECK-NEXT: DefineGetter v14, v15, v13
// CHECK-NEXT: v18 = FinishObject v14
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_6]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v20 = Integer integer=1227
// CHECK-NEXT: v21 = NewObject -, v20 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v22 = NewClosure function=[[f_10]]
// CHECK-NEXT: DefineGetter v21, v22 key="size"
// CHECK-NEXT: v24 = FinishObject v21
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[L_9]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = Data data=[[d_12]]
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|Array site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v28 = ToPropertyKey v2
// CHECK-NEXT: v29 = NewObject -, v27 layout=[[L_14]] fields=[0]
// CHECK-NEXT: v30 = NewClosure function=[[f_15]]
// CHECK-NEXT: SetFunctionName v30, v28 methodKind=Getter
// CHECK-NEXT: DefineGetter v29, v30, v28
// CHECK-NEXT: v33 = ToPropertyKey v2
// CHECK-NEXT: v34 = NewClosure function=[[f_16]]
// CHECK-NEXT: SetFunctionName v34, v33 methodKind=Setter
// CHECK-NEXT: DefineSetter v29, v34, v33
// CHECK-NEXT: v37 = FinishObject v29
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|[[L_14]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v39 = NewDictionary
// CHECK-NEXT: v40 = ToPropertyKey v2
// CHECK-NEXT: v41 = NewClosure function=[[f_18]]
// CHECK-NEXT: SetFunctionName v41, v40 methodKind=Getter
// CHECK-NEXT: DefineGetter v39, v41, v40
// CHECK-NEXT: v44 = Convert v39 declared={type=undefined|null|string|object site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="console" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="log"
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v50 = PropGet v10 key="computed"
// CHECK-NEXT: v51 = Builtin builtin=Object
// CHECK-NEXT: v52 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v53 = Call v52, v51, v10 calleeName="Object.keys"
// CHECK-NEXT: v54 = Convert v53 declared={type=undefined|null|Array<undefined|null|string> site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v55 = Call v49, v47, v50, v54 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v56 = Builtin builtin=GlobalThis
// CHECK-NEXT: v57 = PropGet v56 key="console" [isFreeName]
// CHECK-NEXT: v58 = Convert v57 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v59 = PropGet v58 key="log"
// CHECK-NEXT: v60 = Convert v59 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v61 = Integer integer=3
// CHECK-NEXT: v62 = ElemGet v19, v61
// CHECK-NEXT: v63 = Builtin builtin=Object
// CHECK-NEXT: v64 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v65 = Call v64, v63, v19 calleeName="Object.keys"
// CHECK-NEXT: v66 = Convert v65 declared={type=undefined|null|Array<undefined|null|string> site=[[w_21]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v67 = Call v60, v58, v62, v66 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v68 = Builtin builtin=GlobalThis
// CHECK-NEXT: v69 = PropGet v68 key="console" [isFreeName]
// CHECK-NEXT: v70 = Convert v69 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v71 = PropGet v70 key="log"
// CHECK-NEXT: v72 = Convert v71 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v73 = PropGet v25 key="size"
// CHECK-NEXT: v74 = TypeOf v73
// CHECK-NEXT: v75 = PropGet v25 key="size"
// CHECK-NEXT: v76 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v77 = StrictEq v75, v76
// CHECK-NEXT: v78 = Builtin builtin=Object
// CHECK-NEXT: v79 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v80 = String string="size"
// CHECK-NEXT: v81 = Call v79, v78, v25, v80 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v82 = Convert v81 declared={type=undefined|null|number|string|symbol|bigint|[[L_22]] flags=[IsExpected]}
// CHECK-NEXT: v83 = PropGet v82 key="get"
// CHECK-NEXT: v84 = TypeTest v83 testedType=undefined
// CHECK-NEXT: v85 = LogicalNot v84
// CHECK-NEXT: v86 = Call v72, v70, v74, v77, v85 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v87 = String string="a"
// CHECK-NEXT: PropSet v38, v87 key="computed"
// CHECK-NEXT: v89 = Integer integer=2
// CHECK-NEXT: PropSet v38, v89 key="computed"
// CHECK-NEXT: v91 = Builtin builtin=GlobalThis
// CHECK-NEXT: v92 = PropGet v91 key="console" [isFreeName]
// CHECK-NEXT: v93 = Convert v92 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v94 = PropGet v93 key="log"
// CHECK-NEXT: v95 = Convert v94 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v96 = PropGet v38 key="computed"
// CHECK-NEXT: v97 = PropGet v38 key="stored"
// CHECK-NEXT: v98 = Call v95, v93, v96, v97 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v99 = Builtin builtin=GlobalThis
// CHECK-NEXT: v100 = PropGet v99 key="console" [isFreeName]
// CHECK-NEXT: v101 = Convert v100 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v102 = PropGet v101 key="log"
// CHECK-NEXT: v103 = Convert v102 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v104 = PropGet v44 key="computed"
// CHECK-NEXT: v105 = Call v103, v101, v104 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v106 = Undefined
// CHECK-NEXT: Return v106
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array site=[[w_23]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="map"
// CHECK-NEXT: v2 = NewClosure function=[[f_25]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> site=[[w_26]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="describe"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|string|object} illTypedCause=Assertion
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Call v3, -, v4, v5 calleeName="describe"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5(v1):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="describe"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v5 = Convert v0 declared={type=undefined|null|[[L_6]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_6]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v6 key="first"
// CHECK-NEXT: v8 = Call v4, -, v5, v7 calleeName="describe"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5(v8):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b5(v9) role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5(v1):
// CHECK-NEXT: v2 = Builtin builtin=Proxy
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v5 = Data data=[[d_27]]
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_9]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Construct v3, -, v4, v5, v6 calleeName="Proxy"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5(v7):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b5(v8) role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="describe"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|[[L_14]]} illTypedCause=Assertion
// CHECK-NEXT: v5 = Convert v0 declared={type=undefined|null|[[L_14]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = PropGet v5 key="stored"
// CHECK-NEXT: v7 = PropGet v6 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_28]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Call v3, -, v4, v8 calleeName="describe"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_14]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = PropGet v2 key="stored"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Call v4, v3, v1 calleeKey="push" calleeName="this.stored.push"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_29]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewDictionary
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="key"
// CHECK-NEXT: v4 = ToPropertyKey v3
// CHECK-NEXT: v5 = NewClosure function=[[f_30]]
// CHECK-NEXT: SetFunctionName v5, v4 methodKind=Getter
// CHECK-NEXT: DefineGetter v1, v5, v4
// CHECK-NEXT: v8 = Convert v1 declared={type=undefined|null|string|object site=[[w_31]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="describe"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v12 = Convert v0 declared={type=undefined|null|string|object} illTypedCause=Assertion
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="key"
// CHECK-NEXT: v15 = PropGet v8 key="computed"
// CHECK-NEXT: v16 = Call v11, -, v12, v15 calleeName="describe"
// CHECK-NEXT: ReturnCall v16
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" site=[[w_32]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_33]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" site=[[w_32]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="describe"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|string|object} illTypedCause=Assertion
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="describe"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_34]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
