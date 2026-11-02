// RUN: lower
// OPTIONS: builtin-modules

// One method is called with no, one, two and three arguments and with a spread, each at a call site of its own. When the method is replaced, deleted or put back, all five call sites see it at once, whatever number of arguments they pass.
class Mixer {
  mix(a = 1, b = 2, c = 3): number {
    return a * 100 + b * 10 + c;
  }
}
class Loud extends Mixer {
  mix(a = 4, b = 5, c = 6): number {
    return -(a * 100 + b * 10 + c);
  }
}
class Same extends Mixer {}

function none(mixer: Mixer): number {
  return mixer.mix();
}
function one(mixer: Mixer): number {
  return mixer.mix(7);
}
function two(mixer: Mixer): number {
  return mixer.mix(7, 8);
}
function three(mixer: Mixer): number {
  return mixer.mix(7, 8, 9);
}
function spread(mixer: Mixer, list: [number?, number?, number?]): number {
  return mixer.mix(...list);
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const mixers: Mixer[] = [new Mixer(), new Loud(), new Same()];
const ofMixer = Mixer.prototype.mix;
const ofLoud = Loud.prototype.mix;

function round(): void {
  for (const mixer of mixers) {
    note("none", attempt(() => none(mixer)));
    note("one", attempt(() => one(mixer)));
    note("two", attempt(() => two(mixer)));
    note("three", attempt(() => three(mixer)));
    note("a spread of two", attempt(() => spread(mixer, [5, 6])));
  }
}

round();
Mixer.prototype.mix = function () {
  return 1000 + arguments.length;
};
round();
Loud.prototype.mix = (...all: number[]) => 2000 + all.length;
round();
Reflect.deleteProperty(Loud.prototype, "mix");
round();
Reflect.deleteProperty(Mixer.prototype, "mix");
round();
Mixer.prototype.mix = ofMixer;
Loud.prototype.mix = ofLoud;
round();

export {};

// GENERATED: spread attempt note Mixer Loud
// CHECK-LABEL: function {{*}}name="spread"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array<undefined|number> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|Array<undefined|number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="mix"
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v3, v1
// CHECK-NEXT: v5 = CallList v2, v0, v3 calleeKey="mix" calleeName="mixer.mix"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=number site=[[w_5]]}}, {declared={type=number site=[[w_4]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="TypeError" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v7 = InstanceOf v3, v6 writtenExpression="error instanceof TypeError"
// CHECK-NEXT: v8 = ToBoolean v7
// CHECK-NEXT: Branch v8 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = Integer integer=-1
// CHECK-NEXT: Jump -> next b8(v10)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v12 = Integer integer=-2
// CHECK-NEXT: Jump -> next b8(v12)
// CHECK-NEXT: b8(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="note"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_11]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Add v8, v1
// CHECK-NEXT: v10 = Call v6, v4, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Mixer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Loud"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
