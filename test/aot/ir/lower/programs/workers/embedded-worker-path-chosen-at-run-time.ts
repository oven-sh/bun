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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = IteratorOpen v2
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v3
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b11():
// CHECK-NEXT: v9 = Convert v7 declared={type=number site=[[w_3]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="Worker" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Worker) flags=[IsExpected]}
// CHECK-NEXT: v18 = ToBoolean v9
// CHECK-NEXT: Branch v18 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v19) handler=b11():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="w1"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v22, v19)
// CHECK-NEXT: b8(v23) handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b11():
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="w2"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v26, v23)
// CHECK-NEXT: b10(v27, v28: number) handler=b11():
// CHECK-NEXT: v29 = Construct v17, -, v27 calleeName="Worker"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v31 = String string="n"
// CHECK-NEXT: v32 = Add v31, v28
// CHECK-NEXT: v33 = Call v1, -, v30, v32 calleeName="ask"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v35 = Await v34
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v37 = Call v14, v12, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v3:
// CHECK-NEXT: v38 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] flags=[IsExpected]}, {type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = NewClosure v0, v1 function=[[f_9]]
// CHECK-NEXT: v6 = Construct v4, -, v5 calleeName="Promise"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 captures=[{type=undefined|null|[[L_6]] flags=[IsExpected]}, {type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} parameters=[{type=undefined|null|[[f_10]] flags=[IsExpected]}, {type=undefined|null|[[f_11]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]], v1: undefined|null|string, v2: undefined|null|[[f_10]], v3: undefined|null|[[f_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = NewClosure v0, v2 function=[[f_13]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v0, v5 key="onmessage"
// CHECK-NEXT: v7 = NewClosure v3 function=[[f_15]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_16]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v0, v8 key="onerror"
// CHECK-NEXT: v10 = PropGet v0 key="postMessage"
// CHECK-NEXT: v11 = Call v10, v0, v1 calleeKey="postMessage" calleeName="w.postMessage"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=undefined|null|[[L_6]] flags=[IsExpected]}, {type=undefined|null|[[f_10]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|[[f_17]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]], v1: undefined|null|[[f_10]], v2: undefined|null|[[f_17]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=String
// CHECK-NEXT: v4 = PropGet v2 key="data"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="String"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Call v1, -, v6 calleeName="resolve"
// CHECK-NEXT: v8 = PropGet v0 key="terminate"
// CHECK-NEXT: v9 = Call v8, v0 calleeKey="terminate" calleeName="w.terminate"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=undefined|null|[[f_11]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_20]]|Event flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_11]], v1: undefined|null|[[L_20]]|Event):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Error" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="worker error: "
// CHECK-NEXT: v6 = PropGet v1 key="message"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_22]]} illTypedCause=Assertion
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: v9 = Construct v4, -, v8 calleeName="Error"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = Call v0, -, v10 calleeName="reject"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_14]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_16]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_23]]]
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
