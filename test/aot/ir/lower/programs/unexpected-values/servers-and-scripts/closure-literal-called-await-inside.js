// RUN: lower
// OPTIONS: builtin-modules

// A closure in a literal is called after an await inside an async context.
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

async function handle({ getRouter, request, executeRouter, context, executed, signal, event }) {
  const router = await getRouter();
  if (signal.aborted || executed || !event) throw new Error("stopped");
  return executeRouter(context, router, request);
}

async function resolveRequest(request, options, event) {
  const signal = { aborted: false };
  let routerPromise;
  let executed;
  const getRouter = () => {
    routerPromise ??= (async () => {
      if (signal.aborted) throw new Error("aborted");
      return { request, options, event };
    })();
    return routerPromise;
  };
  const start = { getRouter, request, executed };
  const executeRouter = async (context, matched, instance) => {
    if (signal.aborted) throw new Error("aborted");
    return request.id + (options.extra ?? 0) + matched.request.id + instance.id + context.weight;
  };
  const terminal = ({ context }) =>
    storage.run({ ...start, after: context }, () => handle({ getRouter, request, executeRouter, context, executed, signal, event }));
  return await terminal({ context: { weight: 1 } });
}

const rounds = Number(process.env.ROUNDS ?? 2000);
let total = 0;
for (let round = 0; round < rounds; round++) {
  const batch = [];
  for (let i = 0; i < 16; i++) batch.push(resolveRequest({ id: i, text: "request " + round }, {}, { round }));
  for (const value of await Promise.all(batch)) total += value;
}
console.log(total);

// GENERATED: resolveRequest getRouter terminal
// CHECK-LABEL: function {{*}}name="resolveRequest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}, {type=undefined|null|[[L_3]] flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol|bigint|[[L_1]], v2: undefined|null|number|string|symbol|bigint|[[L_2]], v3: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = NewObject layout=[[L_4]]
// CHECK-NEXT: v5 = Data data=[[d_5]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Promise<undefined|null|[[L_7]]> flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v4, v8 layout=[[L_4]]
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = NewClosure v4, v1, v2, v3, v6 function=[[f_8]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v13 = NewObject layout=[[L_10]]
// CHECK-NEXT: PropDefine v13, v12 key="getRouter"
// CHECK-NEXT: PropDefine v13, v1 key="request"
// CHECK-NEXT: v16 = Convert v10 declared={type=undefined flags=[IsExpected]}
// CHECK-NEXT: PropDefine v13, v16 key="executed"
// CHECK-NEXT: v18 = FinishObject v13
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v20 = NewClosure v1, v2, v6 function=[[f_11]]
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v22 = NewClosure v1, v3, v6, v16, v12, v19, v21 function=[[f_13]]
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: v24 = Data data=[[d_15]]
// CHECK-NEXT: v25 = Call v23, -, v24
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v27 = Await v26, v1, v2, v3
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getRouter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_4]] flags=[IsFromCompiler]}, {type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}, {type=undefined|null|[[L_3]] flags=[IsExpected]}, {type=undefined|null|[[L_6]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|[[L_7]]> flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: undefined|null|number|string|symbol|bigint|[[L_1]], v2: undefined|null|number|string|symbol|bigint|[[L_2]], v3: undefined|null|[[L_3]], v4: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="routerPromise"
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = NewClosure v1, v2, v3, v4 function=[[f_16]]
// CHECK-NEXT: v10 = Call v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Promise<undefined|null|[[L_7]]> flags=[IsExpected]}
// CHECK-NEXT: v12 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="routerPromise"
// CHECK-NEXT: PutEnvironmentField v0, v11 layout=[[L_4]]
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v16 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="routerPromise"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Promise<undefined|null|[[L_7]]> flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="terminal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 captures=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}, {type=undefined|null|[[L_3]] flags=[IsExpected]}, {type=undefined|null|[[L_6]] flags=[IsExpected]}, {type=anything}, {type=undefined|null|[[f_9]] flags=[IsExpected]}, {type=undefined|null|[[L_10]] flags=[IsExpected]}, {type=undefined|null|[[f_12]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_17]] flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]], v1: undefined|null|[[L_3]], v2: undefined|null|[[L_6]], v3: anything, v4: undefined|null|[[f_9]], v5: undefined|null|[[L_10]], v6: undefined|null|[[f_12]], v7: undefined|null|number|string|symbol|bigint|[[L_17]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined|null
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=NotDestructurable name="context"
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = PropGet v11 key="context"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="storage"
// CHECK-NEXT: v15 = PropGet v14 key="run"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_19]] flags=[IsExpected]}
// CHECK-NEXT: v17 = NewObject layout=[[L_20]]
// CHECK-NEXT: CopyDataProperties v17, v5
// CHECK-NEXT: PropDefine v17, v12 key="after"
// CHECK-NEXT: v20 = FinishObject v17
// CHECK-NEXT: v21 = NewClosure v0, v1, v2, v3, v4, v6, v12 function=[[f_21]]
// CHECK-NEXT: v22 = Call v16, v14, v20, v21 calleeKey="run" calleeName="storage.run"
// CHECK-NEXT: ReturnCall v22 casts=[{declared={type=undefined|null|Promise flags=[IsExpected]}}]
// CHECK-NEXT: }
