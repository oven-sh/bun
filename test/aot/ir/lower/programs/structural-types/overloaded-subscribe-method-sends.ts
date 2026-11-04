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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|string):
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_2]]
// CHECK-NEXT: PropSet v5, v1 key="bytes"
// CHECK-NEXT: PropSet v5, v2 key="label"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b1(| 0), notTaken b2(v5)
// CHECK-NEXT: b1(v11):
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="send"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_3]]} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|[[L_1]] flags=[OmitsNull]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_3]], v1: undefined|null|string, v2: undefined|null|number|string|[[L_1]]):
// CHECK-NEXT: v3 = PropGet v0 key="handlers"
// CHECK-NEXT: v4 = PropGet v3 key="get"
// CHECK-NEXT: v5 = Call v4, v3, v1 calleeKey="get" calleeName="this.handlers.get"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|[[L_4]]> flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = Data data=[[d_5]]
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = IteratorOpen v11
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = IteratorResume v12
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Branch v15 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b9():
// CHECK-NEXT: v18 = PropGet v16 key="handle"
// CHECK-NEXT: v19 = Call v18, v16, v2 calleeKey="handle" calleeName="handler.handle"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b9() role=CatchHandler handler=b11():
// CHECK-NEXT: v20 = CatchValue
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="log"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v26 = String string="  the handler of "
// CHECK-NEXT: v27 = Add v26, v1
// CHECK-NEXT: v28 = String string=" "
// CHECK-NEXT: v29 = Add v27, v28
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v31 = Call v30, -, v20 calleeName="failure"
// CHECK-NEXT: v32 = Add v29, v31
// CHECK-NEXT: v33 = Call v25, v23, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b11():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b11() role=IterationCleanup subject=v12:
// CHECK-NEXT: v34 = CatchException
// CHECK-NEXT: IteratorClose v12 completion=Throw
// CHECK-NEXT: Rethrow v34
// CHECK-NEXT: }
