// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesData = 2

// FILE: main.ts
// One `new Worker()` gets one of two embedded files, chosen at run time.
import w1 from "./w1.ts" with { type: "file" };
import w2 from "./w2.ts" with { type: "file" };
function ask(w: Worker, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    w.onmessage = e => {
      resolve(String(e.data));
      w.terminate();
    };
    w.onerror = e => {
      reject(new Error("worker error: " + e.message));
    };
    w.postMessage(text);
  });
}
for (const n of [0, 1, 0]) console.log(await ask(new Worker(n ? w1 : w2), "n" + n));

// FILE: w1.ts
declare var self: Worker;
const list: number[] = [1, 2, 3];
self.onmessage = event => {
  self.postMessage("w1 got " + event.data + " " + list.map(x => x * 2).join());
};

// FILE: w2.ts
declare var self: Worker;
const list: number[] = [1, 2, 3];
self.onmessage = event => {
  self.postMessage("w2 got " + event.data + " " + list.map(x => x * 2).join());
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = IteratorOpen v2
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v3
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="console" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="log"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="Worker" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Worker) flags=[IsExpected]}
// CHECK-NEXT: v17 = ToBoolean v7
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18) handler=b8():
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="w1"
// CHECK-NEXT: Jump -> next b7(v20)
// CHECK-NEXT: b6(v21) handler=b8():
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="w2"
// CHECK-NEXT: Jump -> next b7(v23)
// CHECK-NEXT: b7(v24) handler=b8():
// CHECK-NEXT: v25 = Construct v16, -, v24 calleeName="Worker"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v27 = String string="n"
// CHECK-NEXT: v28 = Add v27, v7
// CHECK-NEXT: v29 = Call v1, -, v26, v28 calleeName="ask"
// CHECK-NEXT: v30 = Await v29
// CHECK-NEXT: v31 = Call v13, v11, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b8() role=IterationCleanup subject=v3:
// CHECK-NEXT: v32 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]], v1: undefined|null|string):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = NewClosure v0, v1 function=[[f_6]]
// CHECK-NEXT: v6 = Construct v4, -, v5 calleeName="Promise"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 captures=[{type=undefined|null|[[L_5]] flags=[IsExpected] variableName="w"}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined] variableName="text"}] thisType={type=anything} parameters=[{type=undefined|null|[[f_7]] flags=[IsExpected]}, {type=undefined|null|[[f_8]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]], v1: undefined|null|string, v2: undefined|null|[[f_7]], v3: undefined|null|[[f_8]]):
// CHECK-NEXT: v4 = NewClosure v0, v2 function=[[f_9]]
// CHECK-NEXT: PropSet v0, v4 key="onmessage"
// CHECK-NEXT: v6 = NewClosure v3 function=[[f_10]]
// CHECK-NEXT: PropSet v0, v6 key="onerror"
// CHECK-NEXT: v8 = PropGet v0 key="postMessage"
// CHECK-NEXT: v9 = Call v8, v0, v1 calleeKey="postMessage" calleeName="w.postMessage"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=undefined|null|[[L_5]] flags=[IsExpected] variableName="w"}, {type=undefined|null|[[f_7]] flags=[IsExpected] variableName="resolve"}] thisType={type=anything} parameters=[{type=undefined|null|[[f_11]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]], v1: undefined|null|[[f_7]], v2: undefined|null|[[f_11]]):
// CHECK-NEXT: v3 = Builtin builtin=String
// CHECK-NEXT: v4 = PropGet v2 key="data"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="String"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Call v1, -, v6 calleeName="resolve"
// CHECK-NEXT: v8 = PropGet v0 key="terminate"
// CHECK-NEXT: v9 = Call v8, v0 calleeKey="terminate" calleeName="w.terminate"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=undefined|null|[[f_8]] flags=[IsExpected] variableName="reject"}] thisType={type=anything} parameters=[{type=undefined|null|[[L_12]]|Event flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_8]], v1: undefined|null|[[L_12]]|Event):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Error" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="worker error: "
// CHECK-NEXT: v6 = PropGet v1 key="message"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Construct v4, -, v7 calleeName="Error"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Call v0, -, v9 calleeName="reject"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
