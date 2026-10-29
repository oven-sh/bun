// RUN: lower
// OPTIONS: builtin-modules

// Whole numbers that were computed as fractions are looked up.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const computations = {
  half: value => value / 2,
  sum: value => value / 4 + value / 4,
  root: value => Math.sqrt(value * value) / 2,
  floor: value => Math.floor(value / 2 + 0.25),
  round: value => Math.round(value / 2 - 0.25),
  fromAFloatArray: value => new Float64Array([value / 2])[0],
  parsed: value => parseFloat(String(value / 2) + ".0"),
  power: value => (value / 2) ** 1,
  product: value => value * 0.5,
  minimum: value => Math.min(value / 2, 1e9),
  remainder: value => (value / 2) % 1e9,
  negatedTwice: value => -(-value / 2),
};

const lookups = {
  indexOf: (list, number) => list.indexOf(number),
  lastIndexOf: (list, number) => list.lastIndexOf(number),
  includes: (list, number) => list.includes(number),
  element: (list, number) => list[number],
  at: (list, number) => list.at(number),
  has: (list, number) => number in list,
  own: (list, number) => Object.hasOwn(list, number),
  store(list, number) {
    list[number] = "stored";
    return Object.keys(list).join();
  },
  remove(list, number) {
    delete list[number];
    return Object.keys(list).join();
  },
  slice: (list, number) => list.slice(number),
  withCopy: (list, number) => list.with(number, "with"),
  splice: (list, number) => list.splice(number, 1),
  fill: (list, number) => list.fill("filled", number),
  truncate(list, number) {
    list.length = number;
    return list;
  },
  sized: (list, number) => new Array(number).length,
  from: (list, number) => Array.from({ length: number }, (_, index) => index),
  inASet: (list, number) => new Set(list).has(number),
  inAMap: (list, number) => new Map(list.map(value => [value, "found " + value])).get(number),
  asASetMember: (list, number) => new Set([number, 2, 0]).size,
  asAKey: (list, number) => ({ 0: "zero", 2: "two" })[number],
  character: (list, number) => "abcd"[number] + "abcd".charAt(number),
  typedElement: (list, number) => new Uint8Array([9, 8, 7, 6])[number],
  findIndex: (list, number) => list.findIndex(value => value === number),
  switched(list, number) {
    switch (number) {
      case 0:
        return "zero";
      case 2:
        return "two";
      default:
        return "neither";
    }
  },
  same: (list, number) => [number === list[1], Object.is(number, list[1]), number == list[1]],
  text: (list, number) => String(number) + "|" + JSON.stringify([number]) + "|" + `${number}`,
};

for (const lookup in lookups) for (let i = 0; i < 1000; i++) lookups[lookup]([1, 2, 3, 0], i & 3);

for (const lookup in lookups) {
  for (const input of [4, 0, -0]) {
    const answers = [];
    for (const computation in computations) {
      let answer;
      try {
        answer = describe(lookups[lookup]([1, 2, 3, 0], computations[computation](input)));
      } catch (error) {
        answer = error.constructor.name;
      }
      if (!answers.includes(answer)) answers.push(answer);
    }
    console.log(lookup + ", from " + describe(input) + ": " + answers.join(" | "));
  }
}

function inOneFunction(list, value) {
  const number = value / 2;
  return [list.indexOf(number), list.includes(number), list[number], list.lastIndexOf(number), number in list, new Set(list).has(number)];
}

function withANegativeZero(list, value) {
  const number = value * -1;
  return [list.indexOf(number), list.includes(number), list[number], list.lastIndexOf(number), number in list, new Set(list).has(number), Object.is(number, -0)];
}

function countingByHalves(list) {
  const seen = [];
  for (let i = 0; i < list.length; i += 0.5) seen.push(list[i]);
  return seen;
}

function countingDownByDivision(list) {
  const seen = [];
  for (let i = 8; i >= 1; i /= 2) seen.push(list[i]);
  return seen;
}

for (let i = 0; i < 1000; i++) {
  inOneFunction([1, 2, 3, 0], 2);
  withANegativeZero([1, 2, 3, 0], 1);
}
attempt("in one function, 4", () => inOneFunction([1, 2, 3, 0], 4));
attempt("in one function, 3", () => inOneFunction([1, 2, 3, 0], 3));
attempt("in one function, 0", () => inOneFunction([1, 2, 3, 0], 0));
attempt("in one function, doubles", () => inOneFunction([1.5, 2, 3.5, 0], 4));
attempt("a negative zero", () => withANegativeZero([1, 2, 3, 0], 0));
attempt("a negative zero among doubles", () => withANegativeZero([1.5, 2, 3.5, 0], 0));
attempt("a negative zero among strings", () => withANegativeZero(["a", 0], 0));
attempt("counting by halves", () => countingByHalves([1, 2, 3]));
attempt("counting down by division", () => countingDownByDivision([0, 1, 2, 3, 4, 5, 6, 7, 8]));

// GENERATED: root round remove from asASetMember same
// CHECK-LABEL: function {{*}}name="root"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathSqrt
// CHECK-NEXT: v3 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Mul v3, v3
// CHECK-NEXT: v5 = Call v2, v1, v4 calleeName="Math.sqrt"
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Div v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="round"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathRound
// CHECK-NEXT: v3 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Div v3, v4
// CHECK-NEXT: v6 = Double number=0.25
// CHECK-NEXT: v7 = Sub v5, v6
// CHECK-NEXT: v8 = Call v2, v1, v7 calleeName="Math.round"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=number flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="remove"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemDelete v0, v1
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeName="Object.keys"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="join"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v8, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="from"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Array<number> flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = NewClosure function=[[f_6]]
// CHECK-NEXT: v5 = Builtin builtin=CompilerHelpersArrayFromLength [isNotReadFromHolder]
// CHECK-NEXT: v6 = Call v5, -, v1, v4
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|Array<number> flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asASetMember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: v5 = Builtin builtin=Set
// CHECK-NEXT: v6 = Construct v5 calleeName="Set"
// CHECK-NEXT: v7 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v8 = Call v7, v6, v1
// CHECK-NEXT: v9 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v10 = Call v9, v6, v2
// CHECK-NEXT: v11 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v12 = Call v11, v6, v3
// CHECK-NEXT: v13 = Convert v6 declared={type=undefined|null|Set flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="size"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}, {type=anything}] results=[{type=undefined|null|Array<boolean> flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = ElemGet v0, v2
// CHECK-NEXT: v4 = StrictEq v1, v3
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectIs
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = ElemGet v0, v7
// CHECK-NEXT: v9 = Call v6, v5, v1, v8 calleeName="Object.is"
// CHECK-NEXT: v10 = Convert v9 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = ElemGet v0, v11
// CHECK-NEXT: v13 = Eq v1, v12
// CHECK-NEXT: v14 = NewArray v4, v10, v13 contents=boolean
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<boolean> flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
