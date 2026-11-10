// RUN: lower
// OPTIONS: builtin-modules

// Generators that are written inside members of classes with private fields evaluate text. Two of the classes are created behind a call that always throws;
// the others are created, and the text reads, writes and asks for their private fields.
function show(run) {
  try {
    console.log(run());
  } catch (error) {
    console.log(`${error.constructor.name}: ${error.message}`);
  }
}

show(() => {
  BigUint64Array();
  const Counter = class {
    static get total() {
      function* each() {
        yield eval("1 + 1");
      }
      return [...each()];
    }
    #count = 1;
  };
  return Counter.total;
});

show(() => {
  Float16Array();
  class Meter {
    #level = 4;
    #raise() {
      return ++this.#level;
    }
    static async read(meter, text) {
      async function* each() {
        yield eval(text);
      }
      const values = [];
      for await (const value of each()) values.push(value);
      return values;
    }
  }
  return Meter.read(new Meter(), "meter.#raise()");
});

class Counter {
  #count = 1;
  static get total() {
    function* each(counter, texts) {
      for (const text of texts) yield eval(text);
    }
    return (counter, ...texts) => [...each(counter, texts)];
  }
}
show(() =>
  Counter.total(new Counter(), "#count in counter", "counter.#count", "counter.#count += 5", "counter.#count"),
);
show(() => Counter.total({}, "#count in counter", "counter.#count"));
show(() => Counter.total(new Counter(), "counter.#size"));

const Unused = class {
  #hidden = "kept";
  static get reader() {
    function* each(text, holder) {
      yield eval(text);
    }
    return each;
  }
};
show(() => [...Unused.reader("#hidden in holder", {})]);
show(() => [...Unused.reader("#hidden in holder", new Unused())]);
show(() => [...Unused.reader("holder.#hidden", new Unused())]);

// GENERATED: show total Unused each #raise read
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v0 calleeName="run"
// CHECK-NEXT: v7 = Call v5, v3, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="console" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="log"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v8 key="constructor"
// CHECK-NEXT: v15 = PropGet v14 key="name"
// CHECK-NEXT: v16 = ToString v15
// CHECK-NEXT: v17 = String string=": "
// CHECK-NEXT: v18 = PropGet v8 key="message"
// CHECK-NEXT: v19 = ToString v18
// CHECK-NEXT: v20 = Strcat v16, v17, v19
// CHECK-NEXT: v21 = Call v13, v11, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: PutEnvironmentField v0, v1 layout=[[L_1]]
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Unused"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsGenerator, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: anything, v6: undefined|null|string|Array<undefined|null|string>, v7: Array):
// CHECK-NEXT: v8 = CreateUnmappedArguments v4, v7, v5, v6
// CHECK-NEXT: v9 = NewObject -, v5, v6 layout=[[L_6]] fields=[0, 1]
// CHECK-NEXT: InitialYield v9, v1, v8
// CHECK-NEXT: v11 = GetEnvironmentField v9 layout=[[L_6]] field=1
// CHECK-NEXT: v12 = IteratorOpen v11
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = IteratorResume v12
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Branch v15 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b12():
// CHECK-NEXT: v18 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="eval" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v22 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v23 = StrictEq v21, v22
// CHECK-NEXT: Branch v23 -> taken b5(), notTaken b6(| 0)
// CHECK-NEXT: b5() handler=b12():
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v25 = DirectEval v18, v1, v3, v18, v9, v0, v8, v24 evalScope=e1
// CHECK-NEXT: Jump -> next b7(v25)
// CHECK-NEXT: b6(v26) handler=b12():
// CHECK-NEXT: v27 = Call v26, -, v18 calleeName="eval"
// CHECK-NEXT: Jump -> next b7(v27)
// CHECK-NEXT: b7(v28) handler=b12():
// CHECK-NEXT: v29 = Yield v28, v9, v1, v8
// CHECK-NEXT: v30 = ResultAt v29
// CHECK-NEXT: v31 = ResultAt v29 index=1
// CHECK-NEXT: Switch v31 cases=[1, 2] -> case b8(), case b9(), otherwise b11()
// CHECK-NEXT: b8() handler=b12():
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b9() handler=b12():
// CHECK-NEXT: Jump -> next b10(v30)
// CHECK-NEXT: b10(v32):
// CHECK-NEXT: IteratorClose v12
// CHECK-NEXT: Return v32
// CHECK-NEXT: b11() handler=b12():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b12() role=IterationCleanup subject=v12:
// CHECK-NEXT: v34 = CatchException
// CHECK-NEXT: IteratorClose v12 completion=Throw
// CHECK-NEXT: Rethrow v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=env [[L_8]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_8]], v1: function, v2: classtoken):
// CHECK-NEXT: v3 = NewObject layout=[[L_9]]
// CHECK-NEXT: v4 = NewClosure v0, v3, v1, v2 function=[[f_10]]
// CHECK-NEXT: PutEnvironmentField v3, v4 layout=[[L_9]]
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: v7 = GetEnvironmentField v3 layout=[[L_9]]
// CHECK-NEXT: v8 = Call v7 calleeName="each"
// CHECK-NEXT: AppendSpread v6, v8
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#raise"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=[[L_11]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: classtoken, v1: [[L_11]]):
// CHECK-NEXT: v2 = PrivateGet v1, v0 layout=[[L_11]] field=1
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: PrivateSet v1, v0, v3 layout=[[L_11]] field=1
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsAsync, HasThis, HasExplicitName] length=2 syntax=[HasLiveAwait] captures=[{type=env [[L_12]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}, {type=anything}] thisType={type=function flags=[IsExpected]} parameters=[{type=anything}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_12]], v1: function, v2: classtoken, v3: anything, v4: function, v5: anything, v6: undefined|null|string):
// CHECK-NEXT: v7 = NewObject -, v5, v6 layout=[[L_13]] fields=[0, 1]
// CHECK-NEXT: v8 = NewClosure v0, v7, v1, v2, v3 function=[[f_14]]
// CHECK-NEXT: PutEnvironmentField v7, v8 layout=[[L_13]] field=2
// CHECK-NEXT: v10 = Data data=[[d_15]]
// CHECK-NEXT: PutEnvironmentField v7, v10 layout=[[L_13]] field=3
// CHECK-NEXT: v12 = GetEnvironmentField v7 layout=[[L_13]] field=2
// CHECK-NEXT: v13 = Call v12 calleeName="each"
// CHECK-NEXT: v14 = IteratorOpen v13 iteratorKind=Async
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = IteratorResume v14, -, v7, v4 iteratorKind=Async
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Branch v17 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v19 = PropGet v10 key="push"
// CHECK-NEXT: v20 = Call v19, v10, v18 calleeKey="push" calleeName="values.push"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v14:
// CHECK-NEXT: v21 = CatchException
// CHECK-NEXT: IteratorClose v14, v7, v4 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsGenerator, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=env [[L_16]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_16]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: undefined|null|string, v6: anything, v7: Array):
// CHECK-NEXT: v8 = CreateUnmappedArguments v4, v7, v5, v6
// CHECK-NEXT: v9 = NewObject -, v5, v6 layout=[[L_17]] fields=[0, 1]
// CHECK-NEXT: InitialYield v9, v1, v8
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="eval" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v14 = GetEnvironmentField v9 layout=[[L_17]]
// CHECK-NEXT: v15 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v16 = StrictEq v13, v15
// CHECK-NEXT: Branch v16 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v18 = DirectEval v14, v1, v3, v9, v0, v8, v17 evalScope=e2
// CHECK-NEXT: Jump -> next b3(v18)
// CHECK-NEXT: b2(v19):
// CHECK-NEXT: v20 = Call v19, -, v14 calleeName="eval"
// CHECK-NEXT: Jump -> next b3(v20)
// CHECK-NEXT: b3(v21):
// CHECK-NEXT: v22 = Yield v21, v9, v1, v8
// CHECK-NEXT: v23 = ResultAt v22
// CHECK-NEXT: v24 = ResultAt v22 index=1
// CHECK-NEXT: Switch v24 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v23
// CHECK-NEXT: b6():
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsGenerator, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_8]] flags=[IsFromCompiler]}, {type=env [[L_9]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_8]], v1: env [[L_9]], v2: function, v3: classtoken, v4: anything, v5: function, v6: anything, v7: int[0, 4294967295], v8: Array):
// CHECK-NEXT: v9 = CreateUnmappedArguments v7, v8
// CHECK-NEXT: InitialYield v4, v9
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="eval" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="1 + 1"
// CHECK-NEXT: v15 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v16 = StrictEq v13, v15
// CHECK-NEXT: Branch v16 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v17 = DirectEval v14, v4, v6, v1, v0, v9, v3 evalScope=e3
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b2(v18):
// CHECK-NEXT: v19 = Call v18, -, v14 calleeName="eval"
// CHECK-NEXT: Jump -> next b3(v19)
// CHECK-NEXT: b3(v20):
// CHECK-NEXT: v21 = Yield v20, v4, v9
// CHECK-NEXT: v22 = ResultAt v21
// CHECK-NEXT: v23 = ResultAt v21 index=1
// CHECK-NEXT: Switch v23 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v22
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v22
// CHECK-NEXT: b6():
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsAsync, IsGenerator, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_12]] flags=[IsFromCompiler]}, {type=env [[L_13]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_12]], v1: env [[L_13]], v2: function, v3: classtoken, v4: anything, v5: anything, v6: function, v7: anything, v8: int[0, 4294967295], v9: Array):
// CHECK-NEXT: v10 = CreateUnmappedArguments v8, v9
// CHECK-NEXT: InitialYield v5, v10
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="eval" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v15 = GetEnvironmentField v1 layout=[[L_13]] field=1
// CHECK-NEXT: v16 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v17 = StrictEq v14, v16
// CHECK-NEXT: Branch v17 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v18 = DirectEval v15, v5, v7, v1, v0, v10, v3, v4 evalScope=e4
// CHECK-NEXT: Jump -> next b3(v18)
// CHECK-NEXT: b2(v19):
// CHECK-NEXT: v20 = Call v19, -, v15 calleeName="eval"
// CHECK-NEXT: Jump -> next b3(v20)
// CHECK-NEXT: b3(v21):
// CHECK-NEXT: v22 = Await v21, v5, v10
// CHECK-NEXT: v23 = Yield v22, v5, v10
// CHECK-NEXT: v24 = ResultAt v23
// CHECK-NEXT: v25 = ResultAt v23 index=1
// CHECK-NEXT: Switch v25 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v24
// CHECK-NEXT: b6():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
