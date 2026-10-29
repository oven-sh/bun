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
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_1]]
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = PropGet v2 key="join"
// CHECK-NEXT: v4 = String string=""
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = PropGet v0 key="on"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(EventEmitterPrototypeOn) flags=[IsExpected]}
// CHECK-NEXT: v9 = NewClosure function=[[f_4]]
// CHECK-NEXT: v10 = Call v8, v0, v6, v9 calleeKey="on" calleeName="p.on"
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="child listens"
// CHECK-NEXT: v17 = PropGet v0 key="listenerCount"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(EventEmitterPrototypeListenerCount) flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v18, v0, v6 calleeKey="listenerCount" calleeName="p.listenerCount"
// CHECK-NEXT: v20 = PropGet v0 key="connected"
// CHECK-NEXT: v21 = Call v15, v13, v16, v19, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
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
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="Buffer" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="isBuffer"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(BufferIsBuffer) flags=[IsExpected]}
// CHECK-NEXT: v17 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="bytes"
// CHECK-NEXT: v19 = Call v16, v14, v18 calleeKey="isBuffer" calleeName="Buffer.isBuffer"
// CHECK-NEXT: v20 = Builtin builtin=String
// CHECK-NEXT: v21 = PropGet v17 key="bytes"
// CHECK-NEXT: v22 = Call v20, -, v21 calleeName="String"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = Call v5, v3, v6, v11, v19, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="p"
// CHECK-NEXT: v27 = PropGet v26 key="exit"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ProcessExit) flags=[IsExpected]}
// CHECK-NEXT: v29 = Integer
// CHECK-NEXT: v30 = Call v28, v26, v29 calleeKey="exit" calleeName="p.exit"
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
