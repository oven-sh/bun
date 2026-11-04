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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="acrossAnAwait"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewObject layout=[[L_2]]
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="withResolvers"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(PromiseWithResolvers) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4 calleeKey="withResolvers" calleeName="Promise.withResolvers"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=NotDestructurable name="promise"
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = PropGet v12 key="promise"
// CHECK-NEXT: v14 = PropGet v12 key="resolve"
// CHECK-NEXT: v15 = Null
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_4]] flags=[OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField v1, v16 layout=[[L_2]]
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="setTimeout" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(SetTimeout) flags=[IsExpected]}
// CHECK-NEXT: v21 = NewClosure v1, v14 function=[[f_5]]
// CHECK-NEXT: v22 = Integer
// CHECK-NEXT: v23 = Call v20, -, v21, v22 calleeName="setTimeout"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v25 = Await v13
// CHECK-NEXT: v26 = GetEnvironmentField v1 layout=[[L_2]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="socket"
// CHECK-NEXT: v28 = TypeTest v27 testedType=undefined|null
// CHECK-NEXT: Branch v28 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v29):
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Jump -> next b5(v30)
// CHECK-NEXT: b4(v31):
// CHECK-NEXT: v32 = PropGet v31 key="end"
// CHECK-NEXT: v33 = Call v32, v31 calleeKey="end" calleeName="socket?.end"
// CHECK-NEXT: Jump -> next b5(v33)
// CHECK-NEXT: b5(v34):
// CHECK-NEXT: v35 = NewArray v25, v34 contents=anything
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nullWithoutTheQuestionMark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Null
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_4]] flags=[OmitsUndefined]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = NewClosure function=[[f_8]]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="later"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v5 = PropGet v1 key="end"
// CHECK-NEXT: v6 = Call v5, v1 calleeKey="end" calleeName="socket.end"
// CHECK-NEXT: Return v6
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = PropGet v8 key="constructor"
// CHECK-NEXT: v10 = PropGet v9 key="name"
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Socket"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_9]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
