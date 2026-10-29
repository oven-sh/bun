// RUN: lower
// OPTIONS: builtin-modules

// Primitives answer to the names of objects.
function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

class Playlist {
  constructor(length, name, size) {
    this.length = length;
    this.name = name;
    this.size = size;
    this.description = "a playlist";
  }
  toFixed(digits) {
    return "playlist fixed to " + digits;
  }
  at(index) {
    return "track " + index;
  }
  slice(from) {
    return "tracks from " + from;
  }
  valueOf() {
    return this.length;
  }
  toString() {
    return "playlist " + this.name;
  }
}

function lengthOf(value) {
  return value.length;
}

function nameOf(value) {
  return value.name;
}

function sizeOf(value) {
  return value.size;
}

function descriptionOf(value) {
  return value.description;
}

function fixed(value) {
  return value.toFixed(1);
}

function first(value) {
  return value.at(0);
}

function rest(value) {
  return value.slice(1);
}

function asValue(value) {
  return value.valueOf();
}

function asText(value) {
  return value.toString();
}

function makerOf(value) {
  return value.constructor.name;
}

function setLength(value) {
  value.length = 1;
  return value.length;
}

function setName(value) {
  value.name = "renamed";
  return value.name;
}

function lengthFromPattern({ length }) {
  return length;
}

const uses = [
  [".length", lengthOf],
  [".name", nameOf],
  [".size", sizeOf],
  [".description", descriptionOf],
  [".toFixed(1)", fixed],
  [".at(0)", first],
  [".slice(1)", rest],
  [".valueOf()", asValue],
  [".toString()", value => (typeof value === "function" ? typeof asText(value) : asText(value))],
  [".constructor.name", makerOf],
  [".length = 1", setLength],
  [".name = ..", setName],
  ["{ length }", lengthFromPattern],
];

const values = [
  ["a string", () => "abc"],
  ["a number", () => 3.14159],
  ["-0", () => -0],
  ["a boolean", () => true],
  ["a bigint", () => 7n],
  ["a symbol with a description", () => Symbol("described")],
  ["null", () => null],
  ["undefined", () => undefined],
  ["an array", () => [1, 2, 3]],
  ["a frozen array", () => Object.freeze([1, 2, 3])],
  ["a function of two parameters", () => function two(a, b) {}],
  ["a class", () => class Named { static size = "static size"; }],
  ["arguments", () => (function () { return arguments; })(1, 2)],
  ["a typed array", () => new Uint8Array([1, 2, 3])],
  ["a Map", () => new Map([[1, 2]])],
  ["a Set", () => new Set([1, 2])],
  ["a String object", () => new String("abc")],
  ["a Number object", () => new Number(2.5)],
  ["an Error", () => new RangeError("out")],
  ["a regular expression", () => /x/g],
  ["a literal with the names", () => ({ length: "long", name: "literal", size: "big", description: "a literal" })],
  ["a string joined at run time", () => ["joi", "ned"].join("")],
  ["from JSON, a number", () => JSON.parse("12.5")],
];

function look(phase) {
  for (const [label, make] of values) {
    for (const [name, use] of uses) {
      let line = phase + " | " + label + " | " + name + " -> ";
      try {
        line += show(use(make()));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
}

let count = 0;
for (let i = 0; i < 2000; i++) for (const [, use] of uses) if (use(new Playlist(i % 9, "mix", 3)) !== undefined) count++;
console.log("2000 honest playlists", count);
look("after 2000 playlists");
console.log("honest again", uses.map(([, use]) => show(use(new Playlist(2, "mix", 3)))).join(" "));

// GENERATED: fixed setName lengthFromPattern toString two Named
// CHECK-LABEL: function {{*}}name="fixed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="toFixed"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="toFixed" calleeName="value.toFixed"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setName"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="renamed"
// CHECK-NEXT: PropSet v0, v1 key="name"
// CHECK-NEXT: v3 = PropGet v0 key="name"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lengthFromPattern"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_5]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="length"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_7]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="playlist "
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="name"
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="two"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
