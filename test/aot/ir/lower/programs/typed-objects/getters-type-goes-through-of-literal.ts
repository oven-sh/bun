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
// CHECK-NEXT: v6 = String string="computed"
// CHECK-NEXT: v7 = ToPropertyKey v6
// CHECK-NEXT: v8 = NewClosure function=[[f_4]]
// CHECK-NEXT: SetFunctionName v8, v7 methodKind=Getter
// CHECK-NEXT: DefineGetter v5, v8, v7
// CHECK-NEXT: v11 = Convert v5 declared={type=undefined|null|string|object site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = String string="first"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = Integer integer=3
// CHECK-NEXT: v15 = ToPropertyKey v14
// CHECK-NEXT: v16 = NewObject -, v13 layout=[[L_6]] fields=[0]
// CHECK-NEXT: v17 = NewClosure function=[[f_7]]
// CHECK-NEXT: SetFunctionName v17, v15 methodKind=Getter
// CHECK-NEXT: DefineGetter v16, v17, v15
// CHECK-NEXT: v20 = FinishObject v16
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[L_6]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v22 = Integer integer=1227
// CHECK-NEXT: v23 = NewObject -, v22 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v24 = NewClosure function=[[f_10]]
// CHECK-NEXT: DefineGetter v23, v24 key="size"
// CHECK-NEXT: v26 = FinishObject v23
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_9]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v28 = Data data=[[d_12]]
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Array site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v30 = String string="computed"
// CHECK-NEXT: v31 = ToPropertyKey v30
// CHECK-NEXT: v32 = NewObject -, v29 layout=[[L_14]] fields=[0]
// CHECK-NEXT: v33 = NewClosure function=[[f_15]]
// CHECK-NEXT: SetFunctionName v33, v31 methodKind=Getter
// CHECK-NEXT: DefineGetter v32, v33, v31
// CHECK-NEXT: v36 = String string="computed"
// CHECK-NEXT: v37 = ToPropertyKey v36
// CHECK-NEXT: v38 = NewClosure function=[[f_16]]
// CHECK-NEXT: SetFunctionName v38, v37 methodKind=Setter
// CHECK-NEXT: DefineSetter v32, v38, v37
// CHECK-NEXT: v41 = FinishObject v32
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|[[L_14]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v43 = NewDictionary
// CHECK-NEXT: v44 = String string="computed"
// CHECK-NEXT: v45 = ToPropertyKey v44
// CHECK-NEXT: v46 = NewClosure function=[[f_18]]
// CHECK-NEXT: SetFunctionName v46, v45 methodKind=Getter
// CHECK-NEXT: DefineGetter v43, v46, v45
// CHECK-NEXT: v49 = Convert v43 declared={type=undefined|null|string|object site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v50 = Builtin builtin=GlobalThis
// CHECK-NEXT: v51 = PropGet v50 key="console" [isFreeName]
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v52 key="log"
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v55 = String string="computed"
// CHECK-NEXT: v56 = PropGet v11 key="computed"
// CHECK-NEXT: v57 = Builtin builtin=Object
// CHECK-NEXT: v58 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v59 = Call v58, v57, v11 calleeName="Object.keys"
// CHECK-NEXT: v60 = Convert v59 declared={type=undefined|null|Array<undefined|null|string> site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v61 = Call v54, v52, v56, v60 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v62 = Builtin builtin=GlobalThis
// CHECK-NEXT: v63 = PropGet v62 key="console" [isFreeName]
// CHECK-NEXT: v64 = Convert v63 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v65 = PropGet v64 key="log"
// CHECK-NEXT: v66 = Convert v65 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v67 = Integer integer=3
// CHECK-NEXT: v68 = Integer integer=3
// CHECK-NEXT: v69 = ElemGet v21, v68
// CHECK-NEXT: v70 = Builtin builtin=Object
// CHECK-NEXT: v71 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v72 = Call v71, v70, v21 calleeName="Object.keys"
// CHECK-NEXT: v73 = Convert v72 declared={type=undefined|null|Array<undefined|null|string> site=[[w_21]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v74 = Call v66, v64, v69, v73 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v75 = Builtin builtin=GlobalThis
// CHECK-NEXT: v76 = PropGet v75 key="console" [isFreeName]
// CHECK-NEXT: v77 = Convert v76 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v78 = PropGet v77 key="log"
// CHECK-NEXT: v79 = Convert v78 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v80 = PropGet v27 key="size"
// CHECK-NEXT: v81 = TypeOf v80
// CHECK-NEXT: v82 = PropGet v27 key="size"
// CHECK-NEXT: v83 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v84 = StrictEq v82, v83
// CHECK-NEXT: v85 = Builtin builtin=Object
// CHECK-NEXT: v86 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v87 = String string="size"
// CHECK-NEXT: v88 = Call v86, v85, v27, v87 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v89 = Convert v88 declared={type=undefined|null|number|string|symbol|bigint|[[L_22]] flags=[IsExpected]}
// CHECK-NEXT: v90 = PropGet v89 key="get"
// CHECK-NEXT: v91 = TypeTest v90 testedType=undefined
// CHECK-NEXT: v92 = LogicalNot v91
// CHECK-NEXT: v93 = Call v79, v77, v81, v84, v92 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v94 = String string="computed"
// CHECK-NEXT: v95 = String string="a"
// CHECK-NEXT: PropSet v42, v95 key="computed"
// CHECK-NEXT: v97 = String string="computed"
// CHECK-NEXT: v98 = Integer integer=2
// CHECK-NEXT: PropSet v42, v98 key="computed"
// CHECK-NEXT: v100 = Builtin builtin=GlobalThis
// CHECK-NEXT: v101 = PropGet v100 key="console" [isFreeName]
// CHECK-NEXT: v102 = Convert v101 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v103 = PropGet v102 key="log"
// CHECK-NEXT: v104 = Convert v103 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v105 = String string="computed"
// CHECK-NEXT: v106 = PropGet v42 key="computed"
// CHECK-NEXT: v107 = PropGet v42 key="stored"
// CHECK-NEXT: v108 = Call v104, v102, v106, v107 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v109 = Builtin builtin=GlobalThis
// CHECK-NEXT: v110 = PropGet v109 key="console" [isFreeName]
// CHECK-NEXT: v111 = Convert v110 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v112 = PropGet v111 key="log"
// CHECK-NEXT: v113 = Convert v112 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v114 = String string="computed"
// CHECK-NEXT: v115 = PropGet v49 key="computed"
// CHECK-NEXT: v116 = Call v113, v111, v115 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v117 = Undefined
// CHECK-NEXT: Return v117
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
// CHECK-NEXT: v2 = String string="computed"
// CHECK-NEXT: v3 = ToPropertyKey v2
// CHECK-NEXT: v4 = NewClosure function=[[f_30]]
// CHECK-NEXT: SetFunctionName v4, v3 methodKind=Getter
// CHECK-NEXT: DefineGetter v1, v4, v3
// CHECK-NEXT: v7 = Convert v1 declared={type=undefined|null|string|object site=[[w_31]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="describe"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v11 = Convert v0 declared={type=undefined|null|string|object} illTypedCause=Assertion
// CHECK-NEXT: v12 = String string="computed"
// CHECK-NEXT: v13 = PropGet v7 key="computed"
// CHECK-NEXT: v14 = Call v10, -, v11, v13 calleeName="describe"
// CHECK-NEXT: ReturnCall v14
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
