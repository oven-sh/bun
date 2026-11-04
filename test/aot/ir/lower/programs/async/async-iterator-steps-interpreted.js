// RUN: lower
// OPTIONS: builtin-modules

// Async generators created from text at run time have the same built-in next method as compiled ones, so compiled `for await` and `yield*` step them too. They are not compiled generators: each step is an ordinary call.
// Interpreted loops over compiled generators go the other way.
const lines = [];
const show = value => (value instanceof Error ? `${value.name}: ${value.message}` : JSON.stringify(value));

const interpreted = new Function(`
  return {
    async *count(label, limit) {
      for (let i = 0; i < limit; i++) yield label + i;
      return label + " result";
    },
    async *countAfterAwaits(label, limit) {
      for (let i = 0; i < limit; i++) {
        await null;
        yield await Promise.resolve(label + i);
      }
    },
    async *echo(label) {
      let received = yield label + " started";
      while (received !== "stop") received = yield label + " got " + JSON.stringify(received);
      return label + " stopped";
    },
    async *failsAt(label, limit) {
      for (let i = 0; i < limit; i++) yield label + i;
      throw new Error(label + " failed");
    },
    async *relay(source) {
      for await (const value of source) yield "interpreted relay of " + value;
    },
    async *delegate(source) {
      return yield* source;
    },
  };
`)();

async function* count(label, limit) {
  for (let i = 0; i < limit; i++) yield label + i;
  return label + " result";
}

async function* relay(source) {
  for await (const value of source) yield "relay of " + value;
}

async function* delegate(source) {
  const result = yield* source;
  yield "delegate result " + show(result);
}

async function collect(title, source, limit = Infinity) {
  const seen = [];
  try {
    for await (const value of source) {
      seen.push(value);
      if (seen.length >= limit) break;
    }
  } catch (error) {
    seen.push("caught " + show(error));
  }
  lines.push(`${title}: ${seen.join(", ")}`);
}

lines.push("one next method: " + (interpreted.count("", 0).next === count("", 0).next));

await collect("function", interpreted.count("a", 3));
await collect("function, broken off", interpreted.count("b", 3), 2);
await collect("function, awaits inside", interpreted.countAfterAwaits("c", 3));
await collect("function, failure", interpreted.failsAt("d", 2));
await collect("function, empty", interpreted.count("e", 0));
await collect("generator", relay(interpreted.count("f", 3)));
await collect("generator, failure", relay(interpreted.failsAt("g", 1)));
await collect("delegate", delegate(interpreted.count("h", 2)));
await collect("delegate, failure", delegate(interpreted.failsAt("i", 1)));
await collect("interpreted loop over compiled", interpreted.relay(count("j", 3)));
await collect("interpreted delegate to compiled", delegate(interpreted.delegate(count("k", 2))));
await collect("alternating", relay(interpreted.relay(relay(interpreted.count("l", 2)))));

const outer = delegate(interpreted.echo("echo"));
for (const sent of [undefined, 1, { a: 1 }, undefined, "stop", "late"]) lines.push("sent " + show(sent) + ": " + show(await outer.next(sent)));

const order = [];
async function loop(label, source) {
  for await (const value of source) {
    order.push(label + value);
    await null;
  }
}
await Promise.all([loop("x:", count("m", 3)), loop("y:", interpreted.count("n", 3)), loop("z:", interpreted.countAfterAwaits("o", 2)), loop("w:", delegate(interpreted.count("p", 2)))]);
lines.push("four loops at once: " + order.join(", "));

const finished = interpreted.count("q", 1);
await collect("first loop", finished);
await collect("second loop over a finished generator", finished);

console.log(lines.join("\n"));

// GENERATED: relay show
// CHECK-LABEL: function {{*}}name="relay"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything):
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = IteratorOpen v2 iteratorKind=Async
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4, -, v2 iteratorKind=Async
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: v10 = String string="relay of "
// CHECK-NEXT: v11 = Add v10, v8
// CHECK-NEXT: v12 = Await v11, v2
// CHECK-NEXT: v13 = Yield v12, v2
// CHECK-NEXT: v14 = ResultAt v13
// CHECK-NEXT: v15 = ResultAt v13 index=1
// CHECK-NEXT: Switch v15 cases=[1, 2] -> case b5(), case b6(), otherwise b8()
// CHECK-NEXT: b5() handler=b9():
// CHECK-NEXT: Throw v14
// CHECK-NEXT: b6() handler=b9():
// CHECK-NEXT: Jump -> next b7(v14)
// CHECK-NEXT: b7(v16):
// CHECK-NEXT: IteratorClose v4, v2 iteratorKind=Async
// CHECK-NEXT: Return v16
// CHECK-NEXT: b8() handler=b9():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b9() role=IterationCleanup subject=v4:
// CHECK-NEXT: v18 = CatchException
// CHECK-NEXT: IteratorClose v4, v2 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|Error flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Error):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Error" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v4 = InstanceOf v0, v3
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = PropGet v0 key="name"
// CHECK-NEXT: v8 = ToString v7
// CHECK-NEXT: v9 = String string=": "
// CHECK-NEXT: v10 = PropGet v0 key="message"
// CHECK-NEXT: v11 = ToString v10
// CHECK-NEXT: v12 = Strcat v8, v9, v11
// CHECK-NEXT: Return v12
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: v14 = Builtin builtin=JSON
// CHECK-NEXT: v15 = PropGet v14 key="stringify"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v16, v14, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v17
// CHECK-NEXT: }
