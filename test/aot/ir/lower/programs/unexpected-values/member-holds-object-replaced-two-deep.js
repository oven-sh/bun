// RUN: lower
// OPTIONS: builtin-modules

// A member that holds an object is replaced between two deep reads.
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Size {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  area() {
    return this.width * this.height;
  }
}

class SizeTheOtherWayRound {
  constructor(width, height) {
    this.height = height;
    this.width = width;
  }
  area() {
    return "the other area";
  }
}

class Parcel {
  constructor(size) {
    this.size = size;
  }
  replaceSize(size) {
    this.size = size;
  }
}

function readStoreRead(parcel, next) {
  const first = parcel.size.width;
  parcel.size = next;
  return [first, parcel.size.width, parcel.size.height];
}

function readCallRead(parcel, next, replace) {
  const first = parcel.size.width;
  replace(parcel, next);
  return [first, parcel.size.width, parcel.size.height];
}

function readMethodRead(parcel, next) {
  const first = parcel.size.width;
  parcel.replaceSize(next);
  return [first, parcel.size.width, parcel.size.height];
}

function readAliasStoreRead(parcel, next, replace, alias) {
  const first = parcel.size.width;
  alias.size = next;
  return [first, parcel.size.width, parcel.size.height];
}

function readComputedStoreRead(parcel, next, replace, alias, name) {
  const first = parcel.size.width;
  parcel[name] = next;
  return [first, parcel.size.width, parcel.size.height];
}

function loopWithAStoreInside(parcel, next) {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(parcel.size.width);
    if (i === 1) parcel.size = next;
  }
  return seen;
}

function callStoreCall(parcel, next) {
  const first = parcel.size.area();
  parcel.size = next;
  return [first, parcel.size.area()];
}

function keptThenReplaced(parcel, next) {
  const kept = parcel.size;
  parcel.size = next;
  return [kept.width, parcel.size.width, kept === parcel.size];
}

function storeThroughTheOldOne(parcel, next) {
  const kept = parcel.size;
  parcel.size = next;
  kept.width = "stored into the old one";
  return [kept.width, parcel.size.width];
}

const forms = [
  ["read, store, read", readStoreRead],
  ["read, a call that stores, read", readCallRead],
  ["read, a method that stores, read", readMethodRead],
  ["read, a store through another name for the parcel, read", readAliasStoreRead],
  ["read, a store under a computed name, read", readComputedStoreRead],
  ["a loop with a store inside", loopWithAStoreInside],
  ["area(), store, area()", callStoreCall],
  ["the old one is kept", keptThenReplaced],
  ["a store through the old one", storeThroughTheOldOne],
];

function replaceInSight(parcel, next) {
  parcel.size = next;
}
function replaceByReflect(parcel, next) {
  Reflect.set(parcel, ["si", "ze"].join(""), next);
}

const nexts = [
  ["another honest size", () => new Size(30, 40)],
  ["the other field order", () => new SizeTheOtherWayRound(30, 40)],
  ["a literal", () => ({ width: 30, height: 40 })],
  ["a literal with members in front", () => ({ depth: 1, color: 2, width: 30, height: 40 })],
  ["a size with strings", () => new Size("w", "h")],
  ["a size with a getter", () => Object.defineProperty(new Size(30, 40), "width", { get: () => "got" })],
  ["an empty literal", () => ({})],
  ["a string", () => "size"],
  ["a number", () => 5],
  ["null", () => null],
  ["undefined", () => undefined],
];

for (let i = 0; i < 2000; i++) {
  for (const [, form] of forms) {
    const parcel = new Parcel(new Size(3, 4));
    form(parcel, new Size(i % 5, 6), replaceInSight, parcel, "size");
  }
}

for (const [replaceLabel, replace] of [["a plain store", replaceInSight], ["Reflect.set and a joined name", replaceByReflect]]) {
  for (const [formLabel, form] of forms) {
    if (replace === replaceByReflect && form !== readCallRead) continue;
    for (const [nextLabel, makeNext] of nexts) {
      const parcel = new Parcel(new Size(3, 4));
      let line = formLabel + (form === readCallRead ? " (" + replaceLabel + ")" : "") + " | " + nextLabel + " -> ";
      try {
        line += show(form(parcel, makeNext(), replace, parcel, ["si", "ze"].join("")));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
}

// GENERATED: readComputedStoreRead keptThenReplaced replaceByReflect area Parcel
// CHECK-LABEL: function {{*}}name="readComputedStoreRead"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=5 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: anything, v2: anything, v3: anything, v4: anything):
// CHECK-NEXT: v5 = PropGet v0 key="size"
// CHECK-NEXT: v6 = PropGet v5 key="width"
// CHECK-NEXT: ElemSet v0, v4, v1
// CHECK-NEXT: v8 = PropGet v0 key="size"
// CHECK-NEXT: v9 = PropGet v8 key="width"
// CHECK-NEXT: v10 = PropGet v0 key="size"
// CHECK-NEXT: v11 = PropGet v10 key="height"
// CHECK-NEXT: v12 = NewArray v6, v9, v11 contents=anything
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keptThenReplaced"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="size"
// CHECK-NEXT: PropSet v0, v1 key="size"
// CHECK-NEXT: v4 = PropGet v2 key="width"
// CHECK-NEXT: v5 = PropGet v0 key="size"
// CHECK-NEXT: v6 = PropGet v5 key="width"
// CHECK-NEXT: v7 = PropGet v0 key="size"
// CHECK-NEXT: v8 = StrictEq v2, v7
// CHECK-NEXT: v9 = NewArray v4, v6, v8 contents=anything
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="replaceByReflect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=Reflect
// CHECK-NEXT: v3 = Builtin builtin=ReflectSet
// CHECK-NEXT: v4 = String string="size"
// CHECK-NEXT: v5 = Call v3, v2, v0, v4, v1 calleeName="Reflect.set"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_2]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = PropGet v0 key="height"
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="the other area"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Parcel"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]]}
// CHECK-NEXT: PropSet v4, v1 key="size"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
