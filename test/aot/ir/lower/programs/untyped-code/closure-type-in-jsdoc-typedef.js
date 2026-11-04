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
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_2]]
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: v5 = Call v0, -, v4 calleeName="memoize"
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v5 calleeName="five"
// CHECK-NEXT: v12 = Call v5 calleeName="five"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="calls"
// CHECK-NEXT: v15 = Call v10, v8, v11, v12, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="memoize"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v2 = Boolean
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_4]] field=1
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: PutEnvironmentField v1, v5 layout=[[L_4]] field=2
// CHECK-NEXT: v7 = NewClosure v1 function=[[f_5]]
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="calls"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="calls"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_2]]
// CHECK-NEXT: v7 = Integer integer=5
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_4]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_4]] field=1
// CHECK-NEXT: v2 = CheckInitialized v1 name="cache"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_4]] field=2
// CHECK-NEXT: v6 = CheckInitialized v5 name="result"
// CHECK-NEXT: Return v6
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = GetEnvironmentField v0 layout=[[L_4]] field=2
// CHECK-NEXT: v9 = CheckInitialized v8 name="result"
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v11 = Call v10 calleeName="fn"
// CHECK-NEXT: PutEnvironmentField v0, v11 layout=[[L_4]] field=2
// CHECK-NEXT: v13 = GetEnvironmentField v0 layout=[[L_4]] field=1
// CHECK-NEXT: v14 = CheckInitialized v13 name="cache"
// CHECK-NEXT: v15 = Boolean boolean=true
// CHECK-NEXT: v16 = Convert v15 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v16 layout=[[L_4]] field=1
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: PutEnvironmentField v0, v18 layout=[[L_4]]
// CHECK-NEXT: v20 = GetEnvironmentField v0 layout=[[L_4]] field=2
// CHECK-NEXT: v21 = CheckInitialized v20 name="result"
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
