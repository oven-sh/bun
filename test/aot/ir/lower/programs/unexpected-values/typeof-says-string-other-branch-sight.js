// RUN: lower
// OPTIONS: builtin-modules

// Typeof says string and the other branch gets the rest with the values in plain sight.
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

const made = {
  "'a,b'": () => ('a,b'),
  "''": () => (''),
  "'a' + ',b'": () => ('a' + ',b'),
  "new String('a,b')": () => (new String('a,b')),
  "Object.setPrototypeOf(new String('a,b'), null)": () => (Object.setPrototypeOf(new String('a,b'), null)),
  "Object.setPrototypeOf(new String('a,b'), Array.prototype)": () => (Object.setPrototypeOf(new String('a,b'), Array.prototype)),
  "Object.create(String.prototype)": () => (Object.create(String.prototype)),
  "Object.setPrototypeOf(['a', 'b'], String.prototype)": () => (Object.setPrototypeOf(['a', 'b'], String.prototype)),
  "{ constructor: String, length: 'a lie' }": () => ({ constructor: String, length: 'a lie' }),
  "{ [Symbol.toStringTag]: 'String', length: 'a lie' }": () => ({ [Symbol.toStringTag]: 'String', length: 'a lie' }),
  "Object.assign(new String('a,b'), { [Symbol.toStringTag]: 'Other' })": () => (Object.assign(new String('a,b'), { [Symbol.toStringTag]: 'Other' })),
  "{ __proto__: { [Symbol.hasInstance]: 1 }, length: 3 }": () => ({ __proto__: { [Symbol.hasInstance]: 1 }, length: 3 }),
  "['a', 'b']": () => (['a', 'b']),
  "5": () => (5),
  "5n": () => (5n),
  "null": () => (null),
  "undefined": () => (undefined),
  "true": () => (true),
  "Symbol('a')": () => (Symbol('a')),
  "function f() {}": () => (function f() {}),
  "Buffer.from('a,b')": () => (Buffer.from('a,b')),
  "new Proxy(new String('a,b'), {})": () => (new Proxy(new String('a,b'), {})),
  "String": () => (String),
  "String.prototype": () => (String.prototype),
};

function make(text) {
  return made[text]();
}

function lengthOfTexts(value) {
  if (typeof value === "string") return value.length;
  return "not a text";
}

function upperOrSame(value) {
  return typeof value === "string" ? value.toUpperCase() : value;
}

function notAText(value) {
  if (typeof value !== "string") return "not a text: " + typeof value;
  return value.charCodeAt(0);
}

function textOrList(value) {
  if (typeof value === "string") return value.split(",");
  return value.slice();
}

function textOrNumber(value) {
  if (typeof value === "string") return value + "!";
  if (typeof value === "number") return value + 1;
  return null;
}

function looseTypeof(value) {
  return typeof value == "string" && value.length > 0;
}

function literalFirst(value) {
  return "string" === typeof value ? value.trim() : "no";
}

function byInstanceof(value) {
  return value instanceof String ? "wrapped " + value.length : "not wrapped";
}

function byConstructor(value) {
  return value != null && value.constructor === String ? "made by String: " + value.length : "made by something else";
}

function byTag(value) {
  return Object.prototype.toString.call(value) === "[object String]" ? "tagged String: " + value.length : "tagged otherwise";
}

function eitherKind(value) {
  return typeof value === "string" || value instanceof String ? value.length : -1;
}

const uses = [
  ["length of texts", lengthOfTexts],
  ["upper or same", upperOrSame],
  ["not a text", notAText],
  ["text or list", textOrList],
  ["text or number", textOrNumber],
  ["loose typeof", looseTypeof],
  ["literal first", literalFirst],
  ["instanceof", byInstanceof],
  ["constructor", byConstructor],
  ["tag", byTag],
  ["either kind", eitherKind],
];

const values = [
  "'a,b'",
  "''",
  "'a' + ',b'",
  "new String('a,b')",
  "Object.setPrototypeOf(new String('a,b'), null)",
  "Object.setPrototypeOf(new String('a,b'), Array.prototype)",
  "Object.create(String.prototype)",
  "Object.setPrototypeOf(['a', 'b'], String.prototype)",
  "{ constructor: String, length: 'a lie' }",
  "{ [Symbol.toStringTag]: 'String', length: 'a lie' }",
  "Object.assign(new String('a,b'), { [Symbol.toStringTag]: 'Other' })",
  "{ __proto__: { [Symbol.hasInstance]: 1 }, length: 3 }",
  "['a', 'b']",
  "5",
  "5n",
  "null",
  "undefined",
  "true",
  "Symbol('a')",
  "function f() {}",
  "Buffer.from('a,b')",
  "new Proxy(new String('a,b'), {})",
  "String",
  "String.prototype",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("a,b")).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " of " + text, () => {
      const given = make(text);
      const result = use(given);
      return result === given && typeof given === "object" && given !== null ? "the same object" : typeof result === "function" ? "function " + result.name : result;
    });
  }
}

// GENERATED: looseTypeof byTag Object.create(String.prototype) 5n true Symbol('a') Buffer.from('a,b')
// CHECK-LABEL: function {{*}}name="looseTypeof"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=string
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = PropGet v0 key="length"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Greater v5, v6
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5(v8)
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byTag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=ObjectPrototypeToString
// CHECK-NEXT: v2 = PropGet v1 key="call"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="call" calleeName="Object.prototype.toString.call"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="[object String]"
// CHECK-NEXT: v7 = StrictEq v5, v6
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = String string="tagged String: "
// CHECK-NEXT: v9 = PropGet v0 key="length"
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = String string="tagged otherwise"
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Object.create(String.prototype)"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v2 = Builtin builtin=StringPrototype
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeName="Object.create"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="5n"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|bigint flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = BigInt digits="5"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|bigint flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="true"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Symbol('a')"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|symbol flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Symbol
// CHECK-NEXT: v1 = String string="a"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="Symbol" callNumber=31
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|symbol flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Buffer.from('a,b')"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|Buffer flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Buffer" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="from"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="a,b"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="from" calleeName="Buffer.from"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|Buffer flags=[IsExpected]}}]
// CHECK-NEXT: }
