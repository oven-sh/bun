// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A variable, a property or an element that a nested function assigns: TypeScript narrows it to the null that was stored last and does not see the later store. The slot holds whatever its annotated type allows, and a use of it depends on its current value.
class Socket {
  open = true;
  end() {
    this.open = false;
    return "ended";
  }
}
class Pipe {
  end() {
    return "pipe ended";
  }
}
function later(f: () => void) {
  f();
}
function optionalCall() {
  let socket: Socket | null = null;
  later(() => {
    socket = new Socket();
  });
  // @ts-ignore
  return socket?.end();
}
function optionalRead() {
  let socket: Socket | null = null;
  later(() => {
    socket = new Socket();
  });
  // @ts-ignore
  return socket?.open;
}
function startsUndefined() {
  let socket: Socket | undefined = undefined;
  later(() => {
    socket = new Socket();
  });
  // @ts-ignore
  return socket?.end();
}
function literal() {
  let point: { x: number; y: number } | null = null;
  later(() => {
    point = { x: 1, y: 2 };
  });
  // @ts-ignore
  return [point?.x, point?.y];
}
function staysNull() {
  let socket: Socket | null = null;
  later(() => {});
  // @ts-ignore
  return socket?.end();
}
function inFinally() {
  let socket: Socket | null = null;
  try {
    later(() => {
      socket = new Socket();
    });
    return "tried";
  } finally {
    // @ts-ignore
    console.log("finally:", socket?.end());
  }
}
async function acrossAnAwait() {
  const { promise, resolve } = Promise.withResolvers<string>();
  let socket: Socket | null = null;
  setTimeout(() => {
    socket = new Socket();
    resolve("connected");
  }, 0);
  const said = await promise;
  // @ts-ignore
  return [said, socket?.end()];
}
function oneOfTwo() {
  let either: Socket | Pipe | null = null;
  later(() => {
    either = new Pipe();
  });
  // @ts-ignore
  return either?.end();
}
function withoutTheQuestionMark() {
  let socket: Socket | null = null;
  later(() => {
    socket = new Socket();
  });
  // @ts-ignore
  return socket.end();
}
function nullWithoutTheQuestionMark() {
  let socket: Socket | null = null;
  later(() => {});
  try {
    // @ts-ignore
    return socket.end();
  } catch (e) {
    return (e as Error).constructor.name;
  }
}
class Holder {
  socket: Socket | null = null;
}
function propertyOfAnInstance() {
  const holder = new Holder();
  holder.socket = null;
  later(() => {
    holder.socket = new Socket();
  });
  // @ts-ignore
  return holder.socket?.end();
}
function propertyOfALiteral() {
  const holder: { socket: Socket | null } = { socket: null };
  holder.socket = null;
  later(() => {
    holder.socket = new Socket();
  });
  // @ts-ignore
  return holder.socket?.end();
}
function element() {
  const list: (Socket | null)[] = [null];
  list[0] = null;
  later(() => {
    list[0] = new Socket();
  });
  // @ts-ignore
  return list[0]?.end();
}
for (const f of [optionalCall, optionalRead, startsUndefined, literal, staysNull, inFinally, oneOfTwo, withoutTheQuestionMark, nullWithoutTheQuestionMark, propertyOfAnInstance, propertyOfALiteral, element]) console.log(f.name + ":", JSON.stringify(f()));
console.log("acrossAnAwait:", JSON.stringify(await acrossAnAwait()));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: later acrossAnAwait nullWithoutTheQuestionMark Socket
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="acrossAnAwait"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_3]]
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="withResolvers"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(PromiseWithResolvers) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4 calleeKey="withResolvers" calleeName="Promise.withResolvers"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=NotDestructurable name="promise"
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = PropGet v12 key="promise"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v12 key="resolve"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Null
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField v1, v18 layout=[[L_3]]
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="setTimeout" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(SetTimeout) flags=[IsExpected]}
// CHECK-NEXT: v23 = NewClosure v1, v16 function=[[f_8]]
// CHECK-NEXT: v24 = Integer
// CHECK-NEXT: v25 = Call v22, -, v23, v24 calleeName="setTimeout"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Await v14
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v29 = GetEnvironmentField v1 layout=[[L_3]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="socket"
// CHECK-NEXT: v31 = TypeTest v30 testedType=undefined|null
// CHECK-NEXT: Branch v31 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Jump -> next b8(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: v35 = PropGet v34 key="end"
// CHECK-NEXT: v36 = Call v35, v34 calleeKey="end" calleeName="socket?.end"
// CHECK-NEXT: Jump -> next b8(v36)
// CHECK-NEXT: b8(v37):
// CHECK-NEXT: v38 = NewArray v28, v37 contents=anything
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|object site=[[w_11]]}
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nullWithoutTheQuestionMark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Null
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_6]] site=[[w_13]] flags=[OmitsUndefined]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v3 = NewClosure function=[[f_15]]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="later"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v5 = PropGet v1 key="end"
// CHECK-NEXT: v6 = Call v5, v1 calleeKey="end" calleeName="socket.end"
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = PropGet v8 key="constructor"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|function site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Socket"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_17]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
