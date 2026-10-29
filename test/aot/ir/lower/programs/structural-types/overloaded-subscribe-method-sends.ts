// RUN: lower
// OPTIONS: builtin-modules

// An overloaded subscribe method sends handlers another payload.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Chunk {
  bytes: number;
  label: string;
  constructor(bytes: number, label: string) {
    this.bytes = bytes;
    this.label = label;
  }
  describe(): string {
    return this.label + " of " + this.bytes;
  }
}

type Payload = string | number | Chunk | undefined;

interface Handler<T> {
  handle(payload: T): void;
}

class Hub {
  handlers = new Map<string, Handler<Payload>[]>();
  on(event: "text", handler: Handler<string>): void;
  on(event: "count", handler: Handler<number>): void;
  on(event: "chunk", handler: Handler<Chunk>): void;
  on(event: "end", handler: Handler<undefined>): void;
  on(event: string, handler: Handler<Payload>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }
  send(event: string, payload: Payload): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler.handle(payload);
      } catch (error) {
        console.log("  the handler of " + event + " " + failure(error));
      }
    }
  }
}

const hub = new Hub();

let total = 0;
let quiet = 0;

class Summing implements Handler<number> {
  sum: number = 0;
  handle(n: number): void {
    this.sum += n;
    quiet += n;
  }
}
const summing = new Summing();

hub.on("text", {
  handle(line) {
    console.log("  text: " + text(line) + ", length " + text(line.length) + ", upper " + line.toUpperCase());
  },
});
hub.on("count", {
  handle(n) {
    total += n;
    console.log("  count: " + text(n) + ", doubled " + text(n * 2) + ", total " + text(total));
  },
});
hub.on("chunk", {
  handle(chunk) {
    console.log("  chunk: " + text(chunk) + ", bytes + 1 " + text(chunk.bytes + 1) + ", " + chunk.describe());
  },
});
hub.on("end", {
  handle(nothing) {
    console.log("  end: " + arguments.length + " arguments, first " + text(nothing) + ", undefined " + (nothing === undefined));
  },
});

const payloads: [string, Payload][] = [
  ["a text", "line"],
  ["a number", 5],
  ["a chunk", new Chunk(3, "c")],
  ["nothing", undefined],
];

console.log("honest:");
hub.send("text", "line");
hub.send("count", 5);
hub.send("chunk", new Chunk(3, "c"));
hub.send("end", undefined);

for (let i = 0; i < 2000; i++) summing.handle(1);
console.log("2000 honest counts: " + quiet + " " + summing.sum);
hub.on("count", summing);

for (const event of ["text", "count", "chunk", "end"]) {
  for (const [label, payload] of payloads) {
    console.log(event + " gets " + label + ":");
    hub.send(event, payload);
  }
}
console.log("total " + text(total) + ", quiet " + text(quiet) + ", sum " + text(summing.sum) + ", " + JSON.stringify(summing));

console.log("honest again:");
total = 0;
hub.send("count", 1);
hub.send("text", "again");

// GENERATED: Chunk send
// CHECK-LABEL: function {{*}}name="Chunk"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_1]]}, {type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_4]]
// CHECK-NEXT: v7 = Convert v1 declared={type=number site=[[w_5]]}
// CHECK-NEXT: PropSet v5, v7 key="bytes"
// CHECK-NEXT: v9 = Convert v2 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v5, v9 key="label"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="send"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_7]] site=[[w_8]]} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|[[L_3]] site=[[w_10]] flags=[OmitsNull]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_7]], v1: undefined|null|string, v2: undefined|null|number|string|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="handlers"
// CHECK-NEXT: v4 = PropGet v3 key="get"
// CHECK-NEXT: v5 = Call v4, v3, v1 calleeKey="get" calleeName="this.handlers.get"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|[[L_11]]> site=[[w_12]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Data data=[[d_13]]
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = IteratorOpen v11
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = IteratorResume v12
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Branch v15 -> taken b7(), notTaken b8()
// CHECK-NEXT: b7():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b14():
// CHECK-NEXT: v18 = Convert v16 declared={type=undefined|null|[[L_11]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b12():
// CHECK-NEXT: v19 = PropGet v18 key="handle"
// CHECK-NEXT: v20 = Call v19, v18, v2 calleeKey="handle" calleeName="handler.handle"
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11() handler=b14():
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b12() role=CatchHandler handler=b14():
// CHECK-NEXT: v21 = CatchValue
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="console" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="log"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v27 = String string="  the handler of "
// CHECK-NEXT: v28 = Add v27, v1
// CHECK-NEXT: v29 = String string=" "
// CHECK-NEXT: v30 = Add v28, v29
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v32 = Call v31, -, v21 calleeName="failure"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v34 = Add v30, v33
// CHECK-NEXT: v35 = Call v26, v24, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13() handler=b14():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b14() role=IterationCleanup subject=v12:
// CHECK-NEXT: v36 = CatchException
// CHECK-NEXT: IteratorClose v12 completion=Throw
// CHECK-NEXT: Rethrow v36
// CHECK-NEXT: }
