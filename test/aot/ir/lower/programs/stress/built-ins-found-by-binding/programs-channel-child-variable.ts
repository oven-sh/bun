// RUN: lower
// OPTIONS: builtin-modules

// Built ins found by binding: programs channel child variable. It prints what plain Bun prints.
const p = process;
const name = ["mess", "age"].join("");
p.on(name, (message: any) => {
  console.log("child got", JSON.stringify(message), Buffer.isBuffer(message.bytes), String(message.bytes));
  p.exit(0);
});
console.log("child listens", p.listenerCount(name), p.connected);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Process
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Data data=[[d_3]]
// CHECK-NEXT: v4 = PropGet v3 key="join"
// CHECK-NEXT: v5 = String string=""
// CHECK-NEXT: v6 = Call v4, v3, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = PropGet v1 key="on"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(EventEmitterPrototypeOn) flags=[IsExpected]}
// CHECK-NEXT: v10 = NewClosure function=[[f_5]]
// CHECK-NEXT: v11 = Call v9, v1, v7, v10 calleeKey="on" calleeName="p.on"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="child listens"
// CHECK-NEXT: v19 = PropGet v1 key="listenerCount"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(EventEmitterPrototypeListenerCount) flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v20, v1, v7 calleeKey="listenerCount" calleeName="p.listenerCount"
// CHECK-NEXT: v22 = Convert v21 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = PropGet v1 key="connected"
// CHECK-NEXT: v24 = Call v17, v15, v18, v22, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="child got"
// CHECK-NEXT: v7 = Builtin builtin=JSON
// CHECK-NEXT: v8 = PropGet v7 key="stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v9, v7, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="Buffer" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="isBuffer"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(BufferIsBuffer) flags=[IsExpected]}
// CHECK-NEXT: v17 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="bytes"
// CHECK-NEXT: v19 = Call v16, v14, v18 calleeKey="isBuffer" calleeName="Buffer.isBuffer"
// CHECK-NEXT: v20 = Convert v19 declared={type=boolean site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = Builtin builtin=String
// CHECK-NEXT: v22 = PropGet v17 key="bytes"
// CHECK-NEXT: v23 = Call v21, -, v22 calleeName="String"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v25 = Call v5, v3, v6, v11, v20, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="p"
// CHECK-NEXT: v28 = PropGet v27 key="exit"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ProcessExit) flags=[IsExpected]}
// CHECK-NEXT: v30 = Integer
// CHECK-NEXT: v31 = Call v29, v27, v30 calleeKey="exit" calleeName="p.exit"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
