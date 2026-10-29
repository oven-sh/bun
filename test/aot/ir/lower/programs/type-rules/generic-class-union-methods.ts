// RUN: lower
// OPTIONS: builtin-modules

type Outcome<T, E> = Success<T, E> | Failure<T, E>;

class Success<T, E> {
  constructor(readonly value: T) {}
  isSuccess(): this is Success<T, E> {
    return true;
  }
  map<A>(f: (value: T) => A): Outcome<A, E> {
    return new Success<A, E>(f(this.value));
  }
  mapError<F>(_f: (error: E) => F): Outcome<T, F> {
    return new Success<T, F>(this.value);
  }
  then<U, F>(f: (value: T) => Outcome<U, F>): Outcome<U, E | F> {
    return f(this.value);
  }
  recover<U, F>(_f: (error: E) => Outcome<U, F>): Outcome<T | U, F> {
    return new Success<T | U, F>(this.value);
  }
  unwrapOr<A>(_fallback: A): T | A {
    return this.value;
  }
  match<A, B = A>(onSuccess: (value: T) => A, _onFailure: (error: E) => B): A | B {
    return onSuccess(this.value);
  }
}

class Failure<T, E> {
  constructor(readonly error: E) {}
  isSuccess(): this is Success<T, E> {
    return false;
  }
  map<A>(_f: (value: T) => A): Outcome<A, E> {
    return new Failure<A, E>(this.error);
  }
  mapError<F>(f: (error: E) => F): Outcome<T, F> {
    return new Failure<T, F>(f(this.error));
  }
  then<U, F>(_f: (value: T) => Outcome<U, F>): Outcome<U, E | F> {
    return new Failure<U, E | F>(this.error);
  }
  recover<U, F>(f: (error: E) => Outcome<U, F>): Outcome<T | U, F> {
    return f(this.error);
  }
  unwrapOr<A>(fallback: A): T | A {
    return fallback;
  }
  match<A, B = A>(_onSuccess: (value: T) => A, onFailure: (error: E) => B): A | B {
    return onFailure(this.error);
  }
}

interface Point {
  x: number;
  y: number;
}
class ParseError {
  constructor(
    readonly text: string,
    readonly position: number,
  ) {}
}
class RangeProblem {
  constructor(readonly limit: number) {}
}

function parseNumber(text: string): Outcome<number, ParseError> {
  const parsed = Number(text);
  return Number.isNaN(parsed) ? new Failure<number, ParseError>(new ParseError(text, 0)) : new Success<number, ParseError>(parsed);
}
function within(limit: number): (value: number) => Outcome<number, RangeProblem> {
  return value => (value > limit ? new Failure<number, RangeProblem>(new RangeProblem(limit)) : new Success<number, RangeProblem>(value));
}
function parsePoint(x: string, y: string): Outcome<Point, ParseError | RangeProblem> {
  return parseNumber(x)
    .then(within(100))
    .then(first => parseNumber(y).map(second => ({ x: first, y: second })));
}
function describe(outcome: Outcome<Point, ParseError | RangeProblem>): string {
  return outcome.match(
    point => `point ${point.x},${point.y}`,
    problem => (problem instanceof ParseError ? `cannot parse ${JSON.stringify(problem.text)} at ${problem.position}` : `over ${problem.limit}`),
  );
}

for (const [x, y] of [
  ["1", "2"],
  ["one", "2"],
  ["1", "two"],
  ["101", "2"],
]) {
  const outcome = parsePoint(x, y);
  console.log(describe(outcome), outcome.isSuccess(), outcome.map(point => point.x + point.y).unwrapOr("none"));
  console.log(
    outcome
      .mapError(problem => (problem instanceof RangeProblem ? problem.limit : problem.text.length))
      .recover(code => (code > 50 ? new Success<string, never>(`recovered from ${code}`) : new Failure<string, number>(code * 2)))
      .match<string | number>(
        value => (typeof value === "string" ? value : value.x * 10 + value.y),
        code => -code,
      ),
  );
}

const outcomes: Outcome<number, string>[] = [new Success<number, string>(1), new Failure<number, string>("no"), new Success<number, string>(3)];
const mappers = outcomes.map(outcome => outcome.map);
console.log(outcomes.map((outcome, index) => mappers[index].call(outcome, (value: number) => value * 2).unwrapOr(-1)).join());
let chained: Outcome<number, string> = new Success<number, string>(0);
for (let i = 0; i < 20; i++) chained = chained.then(value => (value < 15 ? new Success<number, string>(value + 1) : new Failure<number, string>(`stopped at ${value}`)));
console.log(chained.match(String, error => error));
export {};

// GENERATED: parseNumber describe match ParseError
// CHECK-LABEL: function {{*}}name="parseNumber"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]]|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Number
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="Number"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v4 = Builtin builtin=NumberIsNaN
// CHECK-NEXT: v5 = TypeTest v3 testedType=number
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b6(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = Builtin builtin=NumberIsNaN [isNotReadFromHolder]
// CHECK-NEXT: v8 = Call v7, -, v6
// CHECK-NEXT: v9 = Convert v8 declared={type=boolean site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="Failure"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="ParseError"
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Construct v15, -, v0, v16 calleeName="ParseError"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = Construct v13, -, v18 calleeName="Failure"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_3]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b8(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: Jump -> next b7(v6)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: Jump -> next b7(v22)
// CHECK-NEXT: b7(v23: number):
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="Success"
// CHECK-NEXT: v26 = Construct v25, -, v23 calleeName="Success"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_2]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b8(v27)
// CHECK-NEXT: b8(v28):
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|[[L_2]]|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]]|[[L_3]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="match"
// CHECK-NEXT: v2 = NewClosure function=[[f_16]]
// CHECK-NEXT: v3 = NewClosure function=[[f_17]]
// CHECK-NEXT: v4 = Call v1, v0, v2, v3 calleeKey="match" calleeName="outcome.match"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_18]]|[[L_19]] site=[[w_20]]}}, {declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="match"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_2]] site=[[w_21]]} parameters=[{type=undefined|null|[[f_22]] site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_24]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_18]]|[[L_19]] site=[[w_26]]}] functionTypes={{*}}[[f_27]]] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: undefined|null|[[f_22]], v2: undefined|null|[[f_24]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="value"
// CHECK-NEXT: v4 = Call v1, -, v3 calleeName="onSuccess"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_18]] site=[[w_28]]}}, {declared={type=undefined|null|[[L_18]]|[[L_19]] site=[[w_26]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="match"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_3]] site=[[w_29]]} parameters=[{type=undefined|null|[[f_30]] site=[[w_31]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_32]] site=[[w_33]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_34]]|[[L_35]] site=[[w_36]]}] functionTypes={{*}}[[f_37]]] {
// CHECK-NEXT: b0(v0: [[L_3]], v1: undefined|null|[[f_30]], v2: undefined|null|[[f_32]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="error"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="onFailure"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_35]] site=[[w_38]]}}, {declared={type=undefined|null|[[L_34]]|[[L_35]] site=[[w_36]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ParseError"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_39]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_40]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_41]]
// CHECK-NEXT: PropSet v5, v1 key="text"
// CHECK-NEXT: PropSet v5, v2 key="position"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
