// RUN: lower
// OPTIONS: builtin-modules

// `await` in an async generator and at the top level of a module: for each kind of awaited value, jobs run in the same order in code that runs once and in a loop of 10,000.
let log: string[] = [];
let currentStep = 0;
const say = (text: string): void => {
  log.push(text);
};
const show = (value: unknown): void => say("= " + String(value));

// Logs the next `turns` turns of the job queue, until the next step begins, so the log shows in which turn each await resumed.
function begin(name: string, turns: number): void {
  say(name);
  const step = ++currentStep;
  let turn = 0;
  const next = (): void => {
    if (step !== currentStep) return;
    say("turn " + ++turn);
    if (turn < turns) queueMicrotask(next);
  };
  if (turns) queueMicrotask(next);
}
function take(): string {
  const round = log.join(", ");
  log = [];
  return round;
}
function count(rounds: Map<string, number>): void {
  const round = take();
  rounds.set(round, (rounds.get(round) ?? 0) + 1);
}

class Derived<T> extends Promise<T> {
  then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    say("Derived.then");
    return super.then(onFulfilled, onRejected);
  }
}
const one = (): number => 1;
const two = (): string => "two";
const fulfilled = (): Promise<number> => Promise.resolve(3);
const rejected = (): Promise<number> => Promise.reject(new RangeError("four"));
const pending = (): Promise<number> =>
  new Promise<number>(resolve => {
    queueMicrotask(() =>
      queueMicrotask(() => {
        say("resolve");
        resolve(5);
      }),
    );
  });
function withOwnThen(): Promise<number> {
  const promise = Promise.resolve(6);
  (promise as any).then = (): void => say("own then was called");
  return promise;
}
const derived = (): Derived<number> => new Derived<number>(resolve => resolve(7));
const thenable = () => ({
  then(resolve: (value: number) => void): void {
    say("thenable.then");
    resolve(8);
  },
});
const plain = () => ({ value: 9 });
const untyped: unknown[] = [10, "eleven", Promise.resolve(12), null];

async function* awaitOnce(turns: number): AsyncGenerator<void> {
  begin("primitives", turns); show(await one()); show(await two());
  begin("fulfilled", turns); show(await fulfilled());
  begin("rejected", turns); try { show(await rejected()); } catch (error) { show(error); }
  begin("pending", turns); show(await pending());
  begin("own then", turns); show(await withOwnThen());
  begin("derived", turns); show(await derived());
  begin("thenable", turns); show(await thenable());
  begin("plain object", turns); show((await plain()).value);
  begin("untyped", turns); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
  begin("end", 0);
  yield;
}
async function* awaitInLoop(): AsyncGenerator<void> {
  for (let round = 0; round < 10_000; round++) {
    const turns = round & 1 ? 4 : 0;
    begin("primitives", turns); show(await one()); show(await two());
    begin("fulfilled", turns); show(await fulfilled());
    begin("rejected", turns); try { show(await rejected()); } catch (error) { show(error); }
    begin("pending", turns); show(await pending());
    begin("own then", turns); show(await withOwnThen());
    begin("derived", turns); show(await derived());
    begin("thenable", turns); show(await thenable());
    begin("plain object", turns); show((await plain()).value);
    begin("untyped", turns); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
    begin("end", 0);
    yield;
  }
}
async function roundsOf(generator: AsyncGenerator<void>): Promise<Map<string, number>> {
  const rounds = new Map<string, number>();
  for await (const _ of generator) count(rounds);
  return rounds;
}
function report(label: string, once: string[], inLoop: Map<string, number>): void {
  for (const round of once) console.log(label + ": " + round);
  console.log(label + ", in a loop: " + once.map(round => inLoop.get(round)).join() + " of " + inLoop.size + " kinds of rounds");
}

begin("primitives", 0); show(await one()); show(await two());
begin("fulfilled", 0); show(await fulfilled());
begin("rejected", 0); try { show(await rejected()); } catch (error) { show(error); }
begin("pending", 0); show(await pending());
begin("own then", 0); show(await withOwnThen());
begin("derived", 0); show(await derived());
begin("thenable", 0); show(await thenable());
begin("plain object", 0); show((await plain()).value);
begin("untyped", 0); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
begin("end", 0);
const quietRound = take();

begin("primitives", 4); show(await one()); show(await two());
begin("fulfilled", 4); show(await fulfilled());
begin("rejected", 4); try { show(await rejected()); } catch (error) { show(error); }
begin("pending", 4); show(await pending());
begin("own then", 4); show(await withOwnThen());
begin("derived", 4); show(await derived());
begin("thenable", 4); show(await thenable());
begin("plain object", 4); show((await plain()).value);
begin("untyped", 4); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
begin("end", 0);
const busyRound = take();

const roundsAtTopLevel = new Map<string, number>();
for (let round = 0; round < 10_000; round++) {
  const turns = round & 1 ? 4 : 0;
  begin("primitives", turns); show(await one()); show(await two());
  begin("fulfilled", turns); show(await fulfilled());
  begin("rejected", turns); try { show(await rejected()); } catch (error) { show(error); }
  begin("pending", turns); show(await pending());
  begin("own then", turns); show(await withOwnThen());
  begin("derived", turns); show(await derived());
  begin("thenable", turns); show(await thenable());
  begin("plain object", turns); show((await plain()).value);
  begin("untyped", turns); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
  begin("end", 0);
  count(roundsAtTopLevel);
}
report("top level", [quietRound, busyRound], roundsAtTopLevel);

const onceInGenerator = [...(await roundsOf(awaitOnce(0))).keys(), ...(await roundsOf(awaitOnce(4))).keys()];
report("async generator", onceInGenerator, await roundsOf(awaitInLoop()));

export {};

// GENERATED: roundsOf Derived then rejected thenable
// CHECK-LABEL: function {{*}}name="roundsOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|AsyncGenerator flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|Map<undefined|null|string, number>> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|AsyncGenerator):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Map
// CHECK-NEXT: v3 = Construct v2 calleeName="Map"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Map<undefined|null|string, number> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = IteratorOpen v1 iteratorKind=Async
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v5, -, v1 iteratorKind=Async
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v4 declared={type=undefined|null|object site=[[w_2]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = Call v11, -, v4 calleeName="count"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v5:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v5, v1 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="then"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_4]] site=[[w_5]]} parameters=[{type=undefined|null|[[f_6]] site=[[w_7]]}, {type=undefined|null|[[f_8]] site=[[w_9]]}] results=[{type=undefined|null|Promise<undefined|null|[[L_10]]|[[L_11]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_4]], v1: undefined|null|[[f_6]], v2: undefined|null|[[f_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="say"
// CHECK-NEXT: v5 = String string="Derived.then"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="say"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v8 = GetSuperBase v7 homeKind=ClassPrototype
// CHECK-NEXT: v9 = SuperGet v8, v0 key="then"
// CHECK-NEXT: v10 = Call v9, v0, v1, v2 calleeName="super.then"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|Promise<undefined|null|[[L_10]]|[[L_11]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Promise<undefined|null|[[L_10]]|[[L_11]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rejected"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Promise" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="reject"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(PromiseReject) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="RangeError" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="four"
// CHECK-NEXT: v9 = Construct v7, -, v8 calleeName="RangeError"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = Call v4, v2, v10 calleeKey="reject" calleeName="Promise.reject"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="thenable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|[[L_15]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_18]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_15]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_15]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="then"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_20]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="say"
// CHECK-NEXT: v3 = String string="thenable.then"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="say"
// CHECK-NEXT: v5 = Integer integer=8
// CHECK-NEXT: v6 = Call v0, -, v5 calleeName="resolve"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
