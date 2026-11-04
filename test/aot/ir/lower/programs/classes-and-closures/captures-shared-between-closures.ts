// RUN: lower
// OPTIONS: builtin-modules

// Captured variables of one scope that different closures refer to are still shared between every closure that refers to them and the code that declares them.
const out: string[] = [];
function say(name: string, ...values: unknown[]): void {
  out.push(name + ": " + values.map(String).join(" "));
}
function hold<T>(value: T): T {
  return [value][0];
}

function twoCounters() {
  let a = 0, b = 10;
  const first = hold(() => ++a), second = hold(() => ++b), both = hold(() => a + b);
  first();
  first();
  second();
  a += 100;
  return [first(), second(), both(), a, b];
}
function overlappingSets() {
  let a = 1, b = 2, c = 3;
  const ab = hold(() => (a += b)), bc = hold(() => (b += c)), ca = hold(() => (c += a));
  return [ab(), bc(), ca(), ab(), bc(), ca(), a, b, c];
}
function storedToByTheMakerAfterwards() {
  let text = "a", count = 0;
  const read = hold(() => text), bump = hold(() => ++count);
  text += "b";
  bump();
  const seen = read();
  text += "c";
  return [seen, read(), bump(), count];
}
function perIteration() {
  const reads: (() => number)[] = [], bumps: (() => string)[] = [];
  for (let i = 0, label = "x"; i < 3; i++, label += "y") {
    reads.push(() => i++);
    bumps.push(() => (label += "!"));
  }
  return [...reads.map(f => f()), ...reads.map(f => f()), ...bumps.map(f => f()), ...bumps.map(f => f())];
}
function bodyOfALoop() {
  const made: (() => number)[] = [];
  for (const start of [1, 2]) {
    let up = start, down = start;
    made.push(() => ++up, () => --down, () => up * 10 + down);
  }
  return made.map(f => f()).concat(made.map(f => f()));
}
function madeInTheHead() {
  const made: (() => number)[] = [];
  let other = 0;
  for (let i = 0, f = () => i, g = () => ++other; i < 2; i++) {
    made.push(f, g, () => i);
  }
  return [...made.map(f => f()), other];
}
function blocks(flag: boolean) {
  let total = 0;
  const add = hold((n: number) => (total += n));
  {
    let inner = 1;
    const bump = hold(() => ++inner);
    add(bump());
    {
      let deeper = 10;
      const more = hold(() => (deeper += inner));
      add(more());
    }
  }
  if (flag) {
    let inner = 100;
    const bump = hold(() => ++inner);
    add(bump() + bump());
  }
  return total;
}
function caught() {
  let count = 0;
  const bump = hold(() => ++count);
  const made: (() => string)[] = [];
  for (const message of ["a", "b"]) {
    try {
      throw new Error(message);
    } catch (error) {
      let seen = (error as Error).message;
      made.push(() => (seen += bump()));
    }
  }
  return [...made.map(f => f()), ...made.map(f => f()), count];
}
function switched(which: number) {
  let total = 0;
  const add = hold(() => ++total);
  switch (which) {
    case 0: {
      let a = 1;
      const f = hold(() => ++a);
      return [f(), f(), add()];
    }
    case 1:
      let b = 10;
      const g = hold(() => ++b);
      add();
      return [g(), add(), total];
    default:
      return [add()];
  }
}
function hoisted() {
  let a = 0, b = 0;
  const first = hold(one), second = hold(two);
  function one(): number {
    return ++a;
  }
  function two(): number {
    return ++b + one();
  }
  return [first(), second(), first === hold(one), second === hold(two), hold(() => one)() === first, a, b];
}
function helpersThatAreOnlyCalled() {
  let a = 0, b = 0, c = 0;
  function one() {
    a++;
    two();
  }
  function two() {
    b++;
  }
  const kept = hold(() => ++c);
  one();
  one();
  two();
  return [a, b, kept(), c];
}
function classes() {
  let made = 0, named = "n";
  const label = hold(() => (named += "!"));
  class Counted {
    id = ++made;
    static count() {
      return made;
    }
    name() {
      return named + this.id;
    }
  }
  const first = new Counted(), second = new Counted();
  label();
  return [first.name(), second.name(), Counted.count(), made];
}
function* generated() {
  let a = 0, b = 0;
  const first = hold(() => ++a), second = hold(() => ++b);
  yield first();
  yield second() + first();
  yield a * 10 + b;
}
async function awaited() {
  let a = 0, b = 0;
  const first = hold(() => ++a), second = hold(() => ++b);
  await null;
  first();
  await null;
  second();
  a += 10;
  await null;
  return [first(), second(), a, b];
}
function namedExpression() {
  let calls = 0, depth = 0;
  const bump = hold(() => ++calls);
  const recur = hold(function self(n: number): number {
    depth++;
    return n > 0 ? self(n - 1) : depth;
  });
  return [recur(3), bump(), calls, depth];
}
function parameters(a: number, b = a + 1, ...rest: number[]) {
  const first = hold(() => ++a), second = hold(() => ++b), third = hold(() => rest.push(a));
  b += 10;
  return [first(), second(), third(), a, b, rest.join("+")];
}
function deadZones() {
  const early = hold(() => later);
  let count = 0;
  const bump = hold(() => ++count);
  let message = "";
  try {
    early();
  } catch (error) {
    message = (error as Error).name;
  }
  let later = 5;
  later += bump();
  return [message, early(), count];
}
function manyConstants(seed: number) {
  const a = seed, b = seed + 1, c = seed + 2, d = seed + 3, e = seed + 4, f = seed + 5, g = seed + 6;
  const low = hold(() => a + b + c), high = hold(() => e + f + g), all = hold(() => a + b + c + d + e + f + g), one = hold(() => d);
  return [low(), high(), all(), one()];
}
function recursion(n: number): number {
  let mine = n, shared = 0;
  const read = hold(() => mine), bump = hold(() => ++shared);
  if (n > 0) shared += recursion(n - 1);
  return read() + bump();
}

say("two counters", ...twoCounters());
say("overlapping sets", ...overlappingSets());
say("stored to by the maker afterwards", ...storedToByTheMakerAfterwards());
say("per iteration", ...perIteration());
say("body of a loop", ...bodyOfALoop());
say("made in the head", ...madeInTheHead());
say("blocks", blocks(true), blocks(false));
say("caught", ...caught());
say("switched", ...switched(0), ...switched(1), ...switched(2));
say("hoisted", ...hoisted());
say("helpers that are only called", ...helpersThatAreOnlyCalled());
say("classes", ...classes());
say("generated", ...generated());
say("awaited", ...(await awaited()));
say("named expression", ...namedExpression());
say("parameters", ...parameters(1), ...parameters(1, 5, 7, 8));
say("dead zones", ...deadZones());
say("many constants", ...manyConstants(1));
say("recursion", recursion(4));
console.log(out.join("\n"));

// GENERATED: caught Counted name
// CHECK-LABEL: function {{*}}name="caught"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: PutEnvironmentField v0, v2 layout=[[L_1]]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="hold"
// CHECK-NEXT: v7 = Data data=[[d_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|[[f_5]]> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Data data=[[d_6]]
// CHECK-NEXT: v10 = IteratorOpen v9
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = IteratorResume v10
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Branch v13 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = NewArray contents=anything
// CHECK-NEXT: v16 = PropGet v8 key="map"
// CHECK-NEXT: v17 = NewClosure function=[[f_7]]
// CHECK-NEXT: v18 = Call v16, v8, v17 calleeKey="map" calleeName="made.map"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: AppendSpread v15, v19
// CHECK-NEXT: v21 = PropGet v8 key="map"
// CHECK-NEXT: v22 = NewClosure function=[[f_8]]
// CHECK-NEXT: v23 = Call v21, v8, v22 calleeKey="map" calleeName="made.map"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: AppendSpread v15, v24
// CHECK-NEXT: v26 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="count"
// CHECK-NEXT: AppendElement v15, v27
// CHECK-NEXT: Return v15
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b7():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="Error" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v32 = Construct v31, -, v14 calleeName="Error"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v33
// CHECK-NEXT: b6() role=CatchHandler handler=b7():
// CHECK-NEXT: v34 = CatchValue
// CHECK-NEXT: v35 = NewObject layout=[[L_9]]
// CHECK-NEXT: v36 = Convert v34 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v37 = PropGet v36 key="message"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField v35, v38 layout=[[L_9]]
// CHECK-NEXT: v40 = PropGet v8 key="push"
// CHECK-NEXT: v41 = NewClosure v35, v6 function=[[f_10]]
// CHECK-NEXT: v42 = Call v40, v8, v41 calleeKey="push" calleeName="made.push"
// CHECK-NEXT: v43 = Convert v42 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b7() role=IterationCleanup subject=v10:
// CHECK-NEXT: v44 = CatchException
// CHECK-NEXT: IteratorClose v10 completion=Throw
// CHECK-NEXT: Rethrow v44
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] captures=[{type=env [[L_11]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: env [[L_11]], v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_12]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_12]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_12]]}
// CHECK-NEXT: v5 = CallDirect v0, v4 function=[[f_13]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] captures=[{type=env [[L_11]] flags=[IsFromCompiler]}] thisType={type=[[L_12]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_11]], v1: [[L_12]]):
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_11]] field=1
// CHECK-NEXT: v3 = CheckInitialized v2 name="named"
// CHECK-NEXT: v4 = PropGet v1 key="id"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
