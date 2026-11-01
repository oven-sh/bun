// RUN: lower
// OPTIONS: builtin-modules

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

function make(text) {
  return (0, eval)("(" + text + ")");
}

function characterUpper(text, index) {
  return text[index].toUpperCase();
}

function characterKind(text, index) {
  const character = text[index];
  return [typeof character, character === undefined, character + "!"];
}

function atUpper(text, index) {
  return text.at(index).toUpperCase();
}

function charAtUpper(text, index) {
  return text.charAt(index).toUpperCase() + "|";
}

function codePointFixed(text, index) {
  return text.codePointAt(index).toString(16);
}

function codeFixed(text, index) {
  return text.charCodeAt(index).toString(16);
}

function elementLength(index) {
  const names = ["ada", "grace"];
  return names[index].length;
}

function poppedLength(count) {
  const names = ["ada", "grace"];
  let last;
  for (let i = 0; i < count; i++) last = names.pop();
  return last.length;
}

function shiftedUpper(count) {
  const names = ["ada", "grace"];
  let first;
  for (let i = 0; i < count; i++) first = names.shift();
  return first.toUpperCase();
}

function foundLength(letter) {
  return ["ada", "grace"].find(name => name.startsWith(letter)).length;
}

function foundLastLength(letter) {
  return ["ada", "grace"].findLast(name => name.startsWith(letter)).length;
}

function atLength(index) {
  return ["ada", "grace"].at(index).length;
}

function holeLength(index) {
  return ["ada", , "grace"][index].length;
}

function spreadCharacterUpper(text, index) {
  return [...text][index].toUpperCase();
}

function fromCharacterUpper(text, index) {
  return Array.from(text)[index].toUpperCase();
}

function destructuredUpper(text) {
  const [, second] = text;
  return second.toUpperCase();
}

function destructuredWithDefault(text) {
  const [, second = "default"] = text;
  return second.toUpperCase();
}

function lastOfSplit(text) {
  const pieces = text.split("/");
  return pieces[pieces.length].length;
}

function firstOfFiltered(text) {
  return text.split(" ").filter(word => word.length > 3)[0].length;
}

function entryName(object, index) {
  return Object.entries(object)[index][0].toUpperCase();
}

function longest(words) {
  let best;
  for (const word of words) if (best === undefined || word.length > best.length) best = word;
  return best.length;
}

function reduced(words) {
  return words.reduce((a, b) => (a.length >= b.length ? a : b)).length;
}

for (let i = 0; i < 2000; i++) {
  characterUpper("abc", i % 3);
  characterKind("abc", i % 3);
  atUpper("abc", i % 3);
  charAtUpper("abc", i % 3);
  codePointFixed("abc", i % 3);
  codeFixed("abc", i % 3);
  elementLength(i % 2);
  poppedLength(1 + (i % 2));
  shiftedUpper(1 + (i % 2));
  foundLength("a");
  foundLastLength("g");
  atLength(i % 2);
  holeLength(0);
  spreadCharacterUpper("abc", i % 3);
  fromCharacterUpper("abc", i % 3);
  destructuredUpper("abc");
  destructuredWithDefault("abc");
  firstOfFiltered("some words");
  entryName({ a: 1 }, 0);
  longest(["a", "bc"]);
  reduced(["a", "bc"]);
}

for (const index of [0, 2, 3, -1, 99, 1.5, NaN, "1", "x", undefined]) {
  const label = show(index);
  attempt("text[" + label + "].toUpperCase()", () => characterUpper("abc", index));
  attempt("kind of text[" + label + "]", () => characterKind("abc", index));
  attempt("text.at(" + label + ").toUpperCase()", () => atUpper("abc", index));
  attempt("text.charAt(" + label + ").toUpperCase()", () => charAtUpper("abc", index));
  attempt("text.codePointAt(" + label + ").toString(16)", () => codePointFixed("abc", index));
  attempt("text.charCodeAt(" + label + ").toString(16)", () => codeFixed("abc", index));
  attempt("names[" + label + "].length", () => elementLength(index));
  attempt("names.at(" + label + ").length", () => atLength(index));
  attempt("[...text][" + label + "].toUpperCase()", () => spreadCharacterUpper("abc", index));
  attempt("Array.from(text)[" + label + "].toUpperCase()", () => fromCharacterUpper("abc", index));
}
attempt("popped", () => [poppedLength(1), poppedLength(2)]);
attempt("popped once too often", () => poppedLength(3));
attempt("popped never", () => poppedLength(0));
attempt("shifted once too often", () => shiftedUpper(3));
attempt("found nothing", () => foundLength("z"));
attempt("found nothing from the end", () => foundLastLength("z"));
attempt("a hole", () => holeLength(1));
attempt("destructured from a short text", () => destructuredUpper("a"));
attempt("destructured from a short text with a default", () => destructuredWithDefault("a"));
attempt("destructured from the empty text", () => destructuredUpper(""));
attempt("one past the last piece", () => lastOfSplit("a/b"));
attempt("nothing passes the filter", () => firstOfFiltered("a b c"));
attempt("an entry past the end", () => entryName({ a: 1 }, 1));
attempt("the longest of none", () => longest([]));
attempt("reduce of none", () => reduced([]));
attempt("reduce of one", () => reduced(["only"]));

// GENERATED: characterKind holeLength spreadCharacterUpper destructuredUpper entryName make
// CHECK-LABEL: function {{*}}name="characterKind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|number|string flags=[IsExpected]}] results=[{type=undefined|null|Array<undefined|null|boolean|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = TypeOf v2
// CHECK-NEXT: v4 = TypeTest v2 testedType=undefined
// CHECK-NEXT: v5 = String string="!"
// CHECK-NEXT: v6 = Add v2, v5
// CHECK-NEXT: v7 = NewArray v3, v4, v6 contents=undefined|null|boolean|string
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|boolean|string> flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="holeLength"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="ada"
// CHECK-NEXT: v2 = String string="grace"
// CHECK-NEXT: v3 = NewArray v1, v2 contents=undefined|null|string holes=[1]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v5 = ElemGet v4, v0
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spreadCharacterUpper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}, {type=i32 flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array, v1: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v2, v0
// CHECK-NEXT: v4 = Convert v2 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v5 = ElemGet v4, v1
// CHECK-NEXT: v6 = PropGet v5 key="toUpperCase"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v7, v5 calleeKey="toUpperCase" calleeName="toUpperCase"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="destructuredUpper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b6():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b6():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = PropGet v7 key="toUpperCase"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, v7 calleeKey="toUpperCase" calleeName="second.toUpperCase"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: b6() role=IterationCleanup subject=v1:
// CHECK-NEXT: v12 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="entryName"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|object flags=[IsExpected]}, {type=i32 flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|object, v1: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectEntries
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.entries"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|Array> flags=[IsExpected]}
// CHECK-NEXT: v6 = ElemGet v5, v1
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = ElemGet v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="toUpperCase"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10 calleeKey="toUpperCase" calleeName="toUpperCase"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="make"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
