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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v0 calleeName="run"
// CHECK-NEXT: v7 = Call v5, v3, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
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
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_3]]
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: PutEnvironmentField v0, v1 layout=[[L_3]]
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Unused"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=env [[L_3]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=undefined|null|Generator flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: env [[L_3]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: anything, v6: undefined|null|string|Array<undefined|null|string>, v7: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = CreateUnmappedArguments v4, v7, v5, v6
// CHECK-NEXT: v9 = NewObject -, v5, v6 layout=[[L_10]] fields=[0, 1]
// CHECK-NEXT: InitialYield v9, v8
// CHECK-NEXT: v11 = GetEnvironmentField v9 layout=[[L_10]] field=1
// CHECK-NEXT: v12 = IteratorOpen v11
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = IteratorResume v12
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Branch v15 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b13():
// CHECK-NEXT: v18 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="eval" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v22 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v23 = StrictEq v21, v22
// CHECK-NEXT: Branch v23 -> taken b6(), notTaken b7(| 0)
// CHECK-NEXT: b6() handler=b13():
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v25 = DirectEval v18, v1, v3, v18, v9, v0, v8, v24 evalScope=e0
// CHECK-NEXT: Jump -> next b8(v25)
// CHECK-NEXT: b7(v26) handler=b13():
// CHECK-NEXT: v27 = Call v26, -, v18 calleeName="eval"
// CHECK-NEXT: Jump -> next b8(v27)
// CHECK-NEXT: b8(v28) handler=b13():
// CHECK-NEXT: v29 = Yield v28, v9, v8
// CHECK-NEXT: v30 = ResultAt v29
// CHECK-NEXT: v31 = ResultAt v29 index=1
// CHECK-NEXT: Switch v31 cases=[1, 2] -> case b9(), case b10(), otherwise b12()
// CHECK-NEXT: b9() handler=b13():
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b10() handler=b13():
// CHECK-NEXT: Jump -> next b11(v30)
// CHECK-NEXT: b11(v32):
// CHECK-NEXT: IteratorClose v12
// CHECK-NEXT: Return v32
// CHECK-NEXT: b12() handler=b13():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b13() role=IterationCleanup subject=v12:
// CHECK-NEXT: v34 = CatchException
// CHECK-NEXT: IteratorClose v12 completion=Throw
// CHECK-NEXT: Rethrow v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=env [[L_12]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|Array flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_12]], v1: function, v2: classtoken):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewObject layout=[[L_13]]
// CHECK-NEXT: v4 = NewClosure v0, v3, v1, v2 function=[[f_14]]
// CHECK-NEXT: PutEnvironmentField v3, v4 layout=[[L_13]]
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: v7 = GetEnvironmentField v3 layout=[[L_13]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_15]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v8 calleeName="each"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Generator flags=[IsExpected]}
// CHECK-NEXT: AppendSpread v6, v10
// CHECK-NEXT: v12 = Convert v6 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#raise"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=[[L_16]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: [[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_16]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PrivateGet v2, v0 layout=[[L_16]] field=1
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PrivateSet v2, v0, v5 layout=[[L_16]] field=1
// CHECK-NEXT: v7 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, HasExplicitName] length=2 captures=[{type=env [[L_17]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}, {type=anything}] thisType={type=function flags=[IsExpected]} parameters=[{type=anything}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: env [[L_17]], v1: function, v2: classtoken, v3: anything, v4: function, v5: anything, v6: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = NewObject -, v5, v6 layout=[[L_19]] fields=[0, 1]
// CHECK-NEXT: v8 = NewClosure v0, v7, v1, v2, v3 function=[[f_20]]
// CHECK-NEXT: PutEnvironmentField v7, v8 layout=[[L_19]] field=2
// CHECK-NEXT: v10 = Data data=[[d_21]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v7, v12 layout=[[L_19]] field=3
// CHECK-NEXT: v14 = GetEnvironmentField v7 layout=[[L_19]] field=2
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_22]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15 calleeName="each"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|AsyncGenerator flags=[IsExpected]}
// CHECK-NEXT: v18 = IteratorOpen v17 iteratorKind=Async
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v20 = IteratorResume v18, -, v7 iteratorKind=Async
// CHECK-NEXT: v21 = ResultAt v20
// CHECK-NEXT: v22 = ResultAt v20 index=1
// CHECK-NEXT: Branch v21 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v23 = Convert v12 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v23
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v24 = PropGet v12 key="push"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[f_23]] flags=[IsExpected]}
// CHECK-NEXT: v26 = Call v25, v12, v22 calleeKey="push" calleeName="values.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v18:
// CHECK-NEXT: v27 = CatchException
// CHECK-NEXT: IteratorClose v18, v7 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=env [[L_24]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=undefined|null|Generator flags=[IsExpected]}] functionTypes={{*}}[[f_25]]] {
// CHECK-NEXT: b0(v0: env [[L_24]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: undefined|null|string, v6: anything, v7: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = CreateUnmappedArguments v4, v7, v5, v6
// CHECK-NEXT: v9 = NewObject -, v5, v6 layout=[[L_26]] fields=[0, 1]
// CHECK-NEXT: InitialYield v9, v8
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="eval" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v14 = GetEnvironmentField v9 layout=[[L_26]]
// CHECK-NEXT: v15 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v16 = StrictEq v13, v15
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_27]]
// CHECK-NEXT: v18 = DirectEval v14, v1, v3, v9, v0, v8, v17 evalScope=e1
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b3(v19):
// CHECK-NEXT: v20 = Call v19, -, v14 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v20)
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: v22 = Yield v21, v9, v8
// CHECK-NEXT: v23 = ResultAt v22
// CHECK-NEXT: v24 = ResultAt v22 index=1
// CHECK-NEXT: Switch v24 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v23
// CHECK-NEXT: b7():
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_12]] flags=[IsFromCompiler]}, {type=env [[L_13]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|Generator flags=[IsExpected]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: env [[L_12]], v1: env [[L_13]], v2: function, v3: classtoken, v4: anything, v5: function, v6: anything, v7: int[0, 4294967295], v8: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = CreateUnmappedArguments v7, v8
// CHECK-NEXT: InitialYield v9
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="eval" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="1 + 1"
// CHECK-NEXT: v15 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v16 = StrictEq v13, v15
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = DirectEval v14, v4, v6, v1, v0, v9, v3 evalScope=e2
// CHECK-NEXT: Jump -> next b4(v17)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: v19 = Call v18, -, v14 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v19)
// CHECK-NEXT: b4(v20):
// CHECK-NEXT: v21 = Yield v20, v9
// CHECK-NEXT: v22 = ResultAt v21
// CHECK-NEXT: v23 = ResultAt v21 index=1
// CHECK-NEXT: Switch v23 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v22
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v22
// CHECK-NEXT: b7():
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_17]] flags=[IsFromCompiler]}, {type=env [[L_19]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=undefined|null|AsyncGenerator flags=[IsExpected]}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: env [[L_17]], v1: env [[L_19]], v2: function, v3: classtoken, v4: anything, v5: anything, v6: function, v7: anything, v8: int[0, 4294967295], v9: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v10 = CreateUnmappedArguments v8, v9
// CHECK-NEXT: InitialYield v10
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="eval" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v15 = GetEnvironmentField v1 layout=[[L_19]] field=1
// CHECK-NEXT: v16 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v17 = StrictEq v14, v16
// CHECK-NEXT: Branch v17 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = DirectEval v15, v5, v7, v1, v0, v10, v3, v4 evalScope=e3
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b3(v19):
// CHECK-NEXT: v20 = Call v19, -, v15 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v20)
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: v22 = Await v21, v10
// CHECK-NEXT: v23 = Yield v22, v10
// CHECK-NEXT: v24 = ResultAt v23
// CHECK-NEXT: v25 = ResultAt v23 index=1
// CHECK-NEXT: Switch v25 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v24
// CHECK-NEXT: b7():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
