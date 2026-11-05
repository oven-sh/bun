// RUN: lower
// OPTIONS: builtin-modules

// Classes whose members stand under computed keys: one symbol, one text, one of several, a key with side effects, a new symbol for each evaluation.
const log = [];
const say = (...parts) => log.push(parts.map(String).join(" "));
const describe = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const found = Object.getOwnPropertyDescriptor(object, key);
      const kind = "value" in found ? typeof found.value : (found.get ? "get" : "") + (found.set ? "set" : "");
      return `${String(key)}:${kind}:${found.enumerable ? "e" : "-"}${found.configurable ? "c" : "-"}${found.writable ? "w" : "-"}`;
    })
    .join(" ");

const one = Symbol("one");
const bare = Symbol();
const shared = Symbol.for("shared");
const text = "spelled";
const reader = Symbol("reader");
const both = Symbol("both");
const onClass = Symbol("onClass");

class Plain {
  value = 1;
  [one](by) {
    return this.value + by;
  }
  [bare]() {
    return "bare " + this.value;
  }
  [shared]() {
    return "shared " + this.value;
  }
  [text]() {
    return "text " + this.value;
  }
  get [reader]() {
    return "read " + this.value;
  }
  get [both]() {
    return this.value;
  }
  set [both](value) {
    this.value = value * 2;
  }
  static [onClass]() {
    return "of " + this.name;
  }
  static get [reader]() {
    return "static read";
  }
  named() {
    return "named " + this.value;
  }
}

const plain = new Plain();
say(
  "calls",
  plain[one](2),
  plain[bare](),
  plain[shared](),
  plain[Symbol.for("shared")](),
  plain[text](),
  plain.spelled(),
  plain.named(),
);
say("accessors", plain[reader], plain[both], (plain[both] = 4), plain[both], Plain[onClass](), Plain[reader]);
say(
  "names",
  Plain.prototype[one].name,
  Plain.prototype[bare].name,
  Plain.prototype[shared].name,
  Plain.prototype[text].name,
);
say(
  "accessor names",
  Object.getOwnPropertyDescriptor(Plain.prototype, reader).get.name,
  Object.getOwnPropertyDescriptor(Plain.prototype, both).set.name,
);
say("prototype", describe(Plain.prototype));
say("class", describe(Plain));
say("has", one in plain, Object.hasOwn(plain, one), Object.hasOwn(Plain.prototype, one), Symbol("one") in plain);

// The member is replaced, hidden by an own property, deleted.
function callOne(object) {
  return object[one](10);
}
for (let i = 0; i < 3; i++) say("before", callOne(plain));
Plain.prototype[one] = function (by) {
  return "replaced " + (this.value - by);
};
say("replaced", callOne(plain));
plain[one] = () => "own";
say("own", callOne(plain));
delete plain[one];
say("own deleted", callOne(plain));
delete Plain.prototype[one];
try {
  callOne(plain);
} catch (error) {
  say("deleted", error.constructor.name);
}
Object.defineProperty(Plain.prototype, reader, { get: () => "redefined" });
say("redefined", plain[reader]);

// Below another class: an override, super under the key, a key only the parent has.
const up = Symbol("up");
class Parent {
  [up](depth) {
    return "parent " + depth;
  }
  get [reader]() {
    return "parent reader";
  }
}
class Child extends Parent {
  [up](depth) {
    return "child > " + super[up](depth + 1);
  }
}
class Grandchild extends Child {}
for (const object of [new Parent(), new Child(), new Grandchild()]) say("chain", object[up](0), object[reader]);

// One of several keys.
const first = Symbol("first");
const second = Symbol("second");
function makeWithEither(takesFirst) {
  const key = takesFirst ? first : second;
  return class {
    [key]() {
      return "under " + String(key);
    }
    other() {
      return "other";
    }
  };
}
for (const takesFirst of [true, false]) {
  const made = new (makeWithEither(takesFirst))();
  say("either", typeof made[first], typeof made[second], made[takesFirst ? first : second](), made.other());
}

// A new symbol for each evaluation of the class.
function makeWithOwnSymbol() {
  const own = Symbol("own");
  return [
    own,
    class {
      [own]() {
        return "mine";
      }
    },
  ];
}
const [keyA, ClassA] = makeWithOwnSymbol();
const [keyB, ClassB] = makeWithOwnSymbol();
say(
  "fresh",
  keyA === keyB,
  typeof new ClassA()[keyA],
  typeof new ClassA()[keyB],
  typeof new ClassB()[keyA],
  typeof new ClassB()[keyB],
);

// One symbol, a class that is evaluated several times.
const kept = Symbol("kept");
function makeWithKeptSymbol(answer) {
  return class {
    [kept]() {
      return answer;
    }
  };
}
const made = [makeWithKeptSymbol("a"), makeWithKeptSymbol("b")];
say("kept", new made[0]()[kept](), new made[1]()[kept](), made[0].prototype[kept] === made[1].prototype[kept]);

// The keys are evaluated in the order of the members, each once, before any static field.
const order = [];
const note = (label, key) => (order.push(label), key);
class Ordered {
  static early = note("static field", 1);
  [note("method", one)]() {}
  static [note("static method", onClass)]() {}
  get [note("getter", reader)]() {
    return 1;
  }
  [note("field", both)] = note("field value", 2);
  [note("object", { toString: () => note("toString", "fromObject") })]() {}
  [note("last", text)]() {}
}
say("order", order.join(" | "));
new Ordered();
say("order", order.join(" | "));
say("ordered", describe(Ordered.prototype));

// Two members under one key: the last one stays; an accessor and a method under one key.
class Twice {
  [one]() {
    return "first";
  }
  [one]() {
    return "second";
  }
  get [both]() {
    return "getter";
  }
  [both]() {
    return "method";
  }
  [text]() {
    return "computed";
  }
  spelled() {
    return "written";
  }
}
say("twice", new Twice()[one](), new Twice()[both](), new Twice().spelled(), describe(Twice.prototype));

// Names that mean something to a class.
const constructorName = "constructor";
const prototypeName = "prototype";
class Odd {
  [constructorName]() {
    return "a method";
  }
}
say("constructor", new Odd().constructor(), Odd.prototype.constructor === Odd);
try {
  class Refused {
    static [prototypeName]() {}
  }
  say("prototype", typeof Refused);
} catch (error) {
  say("prototype", error.constructor.name);
}

// A key that is read in its dead zone.
try {
  class Early {
    [late]() {}
  }
  say("dead zone", typeof Early);
} catch (error) {
  say("dead zone", error.constructor.name);
}
const late = Symbol("late");

// A key that names an element.
const index = "3";
class Indexed {
  [index]() {
    return "at three";
  }
  [4]() {
    return "at four";
  }
}
say("index", new Indexed()[3](), new Indexed()["4"](), describe(Indexed.prototype));

// What a protocol of the language reads.
const steps = Symbol.iterator;
class Walked {
  *[steps]() {
    yield 1;
    yield 2;
  }
  [Symbol.toPrimitive](hint) {
    return hint === "number" ? 7 : "walked";
  }
  get [Symbol.toStringTag]() {
    return "Tagged";
  }
  static [Symbol.hasInstance](value) {
    return value === 5;
  }
}
say(
  "protocols",
  [...new Walked()],
  +new Walked(),
  `${new Walked()}`,
  Object.prototype.toString.call(new Walked()),
  5 instanceof Walked,
  new Walked() instanceof Walked,
);

// The names that frames show.
class Thrower {
  [one]() {
    throw new Error("method");
  }
  get [reader]() {
    throw new Error("getter");
  }
  static [onClass]() {
    throw new Error("static method");
  }
  [bare]() {
    throw new Error("without a description");
  }
  *[text]() {
    throw new Error("generator");
  }
  async [both]() {
    throw new Error("async method");
  }
  async [shared]() {
    await null;
    throw new Error("async method behind an await");
  }
}
function sayFrames(error) {
  const names = error.stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().split(" (")[0])
    .map(name => (/[\\/]/.test(name) ? "at no name" : name));
  say("frames", error.message + ": " + names.join(" < "));
}
function sayFramesOf(run) {
  try {
    run();
  } catch (error) {
    sayFrames(error);
  }
}
const thrower = new Thrower();
sayFramesOf(() => thrower[one]());
sayFramesOf(() => thrower[reader]);
sayFramesOf(() => Thrower[onClass]());
sayFramesOf(() => thrower[bare]());
sayFramesOf(() => thrower[text]().next());
await thrower[both]().catch(sayFrames);
await thrower[shared]().catch(sayFrames);
say("names", Thrower.prototype[text].name, Thrower.prototype[both].name, Thrower.prototype[shared].name);

// A class and functions that take their names from the keys of an object literal.
const holder = { [one]: class {}, [shared]: function () {}, [text]: () => {}, [bare]: class {} };
say("literal", holder[one].name, holder[shared].name, holder[text].name, JSON.stringify(holder[bare].name));
say("literal", describe(holder[one]), "|", describe(holder[bare]), "|", describe(holder[shared]));

console.log(log.join("\n"));

// GENERATED: makeWithOwnSymbol describe Plain Child toString [Symbol.toStringTag] [Symbol.hasInstance]
// CHECK-LABEL: function {{*}}name="makeWithOwnSymbol"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|symbol|[[f_1]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Symbol
// CHECK-NEXT: v1 = String string="own"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="Symbol" callNumber=66
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|symbol flags=[IsExpected]}
// CHECK-NEXT: v4 = NewClosure function=[[f_2]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_3]]
// CHECK-NEXT: v6 = ToPropertyKey v3
// CHECK-NEXT: v7 = NewClosure function=[[f_4]]
// CHECK-NEXT: SetFunctionName v7, v6
// CHECK-NEXT: DefineMethod v5, v7, v6 layout=[[L_3]]
// CHECK-NEXT: v10 = FinishClass v5 layout=[[L_3]]
// CHECK-NEXT: v11 = NewArray v3, v10 contents=undefined|null|symbol|[[f_1]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|symbol|[[f_1]]> flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="map" calleeName="map"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_11]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Child"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_13]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_14]] flags=[IsExpected]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="note"
// CHECK-NEXT: v2 = String string="toString"
// CHECK-NEXT: v3 = String string="fromObject"
// CHECK-NEXT: v4 = Call v1, -, v2, v3 calleeName="note"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|boolean|number|string|symbol|bigint|[[L_14]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.toStringTag]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="Tagged"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.hasInstance]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=5
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
