// RUN: lower
// OPTIONS: builtin-modules

// A JSDoc comment that TypeScript cannot parse (Closure's `function(): T` in a @typedef, as in webpack's sources) is a comment: the file is valid JavaScript and is built.
/** @template T @typedef {function(): T} FunctionReturning */
/** @typedef {function(string, number=): void} Callback */
/**
 * @template T
 * @param {FunctionReturning<T>} fn memorized function
 * @returns {FunctionReturning<T>} new function
 */
const memoize = fn => {
  let cache = false;
  /** @type {T | undefined} */
  let result = undefined;
  return () => {
    if (cache) return /** @type {T} */ (result);
    result = fn();
    cache = true;
    fn = undefined;
    return /** @type {T} */ (result);
  };
};
let calls = 0;
const five = memoize(() => (calls++, 5));
console.log(five(), five(), calls);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_3]]
// CHECK-NEXT: v5 = NewClosure function=[[f_4]]
// CHECK-NEXT: v6 = Call v1, -, v5 calleeName="memoize"
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v6 calleeName="five"
// CHECK-NEXT: v13 = Call v6 calleeName="five"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="calls"
// CHECK-NEXT: v16 = Call v11, v9, v12, v13, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="memoize"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v2 = Boolean
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_5]] field=1
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v6 layout=[[L_5]] field=2
// CHECK-NEXT: v8 = NewClosure v1 function=[[f_7]]
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="calls"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="calls"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_3]]
// CHECK-NEXT: v7 = Integer integer=5
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_5]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_5]] field=1
// CHECK-NEXT: v2 = CheckInitialized v1 name="cache"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_5]] field=2
// CHECK-NEXT: v6 = CheckInitialized v5 name="result"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_5]] field=2
// CHECK-NEXT: v10 = CheckInitialized v9 name="result"
// CHECK-NEXT: v11 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v12 = Call v11 calleeName="fn"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v13 layout=[[L_5]] field=2
// CHECK-NEXT: v15 = GetEnvironmentField v0 layout=[[L_5]] field=1
// CHECK-NEXT: v16 = CheckInitialized v15 name="cache"
// CHECK-NEXT: v17 = Boolean boolean=true
// CHECK-NEXT: v18 = Convert v17 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v18 layout=[[L_5]] field=1
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: PutEnvironmentField v0, v20 layout=[[L_5]]
// CHECK-NEXT: v22 = GetEnvironmentField v0 layout=[[L_5]] field=2
// CHECK-NEXT: v23 = CheckInitialized v22 name="result"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
