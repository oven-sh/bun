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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=3 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}, {type=undefined|null|[[L_3]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]], v2: undefined|null|number|string|symbol|bigint|[[L_2]], v3: undefined|null|[[L_3]]):
// CHECK-NEXT: v4 = NewObject layout=[[L_4]]
// CHECK-NEXT: v5 = Data data=[[d_5]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Promise<undefined|null|[[L_6]]> flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v4, v7 layout=[[L_4]]
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = NewClosure v4, v1, v2, v3, v5 function=[[f_7]]
// CHECK-NEXT: v11 = NewObject -, v10, v1, v9 layout=[[L_8]] fields=[1, 2, 0]
// CHECK-NEXT: v12 = FinishObject v11
// CHECK-NEXT: v13 = NewClosure v1, v2, v5 function=[[f_9]]
// CHECK-NEXT: v14 = Data data=[[d_10]]
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|number|string|symbol|bigint|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v16 = CallDirect v1, v3, v5, v9, v10, v12, v13, v15 function=[[f_12]]
// CHECK-NEXT: v17 = Await v16, v1, v2, v3
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getRouter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_4]] flags=[IsFromCompiler]}, {type=undefined|null|[[L_1]] flags=[IsExpected] variableName="request"}, {type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected] variableName="options"}, {type=undefined|null|[[L_3]] flags=[IsExpected] variableName="event"}, {type=anything variableName="signal"}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: undefined|null|[[L_1]], v2: undefined|null|number|string|symbol|bigint|[[L_2]], v3: undefined|null|[[L_3]], v4: anything):
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="routerPromise"
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2()
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = NewClosure v1, v2, v3, v4 function=[[f_14]]
// CHECK-NEXT: v10 = Call v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Promise<undefined|null|[[L_6]]> flags=[IsExpected]}
// CHECK-NEXT: v12 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="routerPromise"
// CHECK-NEXT: PutEnvironmentField v0, v11 layout=[[L_4]]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="routerPromise"
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="terminal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 captures=[{type=undefined|null|[[L_1]] flags=[IsExpected] variableName="request"}, {type=undefined|null|[[L_3]] flags=[IsExpected] variableName="event"}, {type=anything variableName="signal"}, {type=anything variableName="executed"}, {type=anything variableName="getRouter"}, {type=anything variableName="start"}, {type=anything variableName="executeRouter"}] thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_11]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|[[L_3]], v2: anything, v3: anything, v4: anything, v5: anything, v6: anything, v7: undefined|null|number|string|symbol|bigint|[[L_11]]):
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined|null
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=NotDestructurable name="context"
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: v12 = PropGet v11 key="context"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="storage"
// CHECK-NEXT: v15 = PropGet v14 key="run"
// CHECK-NEXT: v16 = NewObject layout=[[L_16]]
// CHECK-NEXT: CopyDataProperties v16, v5
// CHECK-NEXT: PropDefine v16, v12 key="after"
// CHECK-NEXT: v19 = FinishObject v16
// CHECK-NEXT: v20 = NewClosure v0, v1, v2, v3, v4, v6, v12 function=[[f_17]]
// CHECK-NEXT: v21 = Call v15, v14, v19, v20 calleeKey="run" calleeName="storage.run"
// CHECK-NEXT: ReturnCall v21
// CHECK-NEXT: }
