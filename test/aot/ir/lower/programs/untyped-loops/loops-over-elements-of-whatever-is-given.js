// RUN: lower
// OPTIONS: builtin-modules

// Loops that read and store elements under a number, given arrays, views of every kind, subclasses, strings and other objects, while the view is shrunk, grown, detached or given other members.
const holder = JSON.parse('{"list":[]}');
function hide(value) {
  holder.list.push(value);
  return holder.list.pop();
}
const lines = [];
function say(name, run) {
  let text;
  try {
    text = String(run());
  } catch (error) {
    text = error.constructor.name;
  }
  lines.push(name + " = " + text);
}

function sum(bytes) {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s = (s + bytes[i]) | 0;
  return s;
}
function join(bytes, from, to, step) {
  let s = "";
  for (let i = from; i < to; i += step) s += bytes[i] + ",";
  return s;
}
function joinUnder(bytes, keys) {
  let s = "";
  for (let k = 0; k < keys.length; k++) s += bytes[keys[k]] + ",";
  return s;
}
function fill(bytes, value) {
  for (let i = 0; i < bytes.length; i++) bytes[i] = value;
  return join(bytes, 0, bytes.length, 1);
}
function fillPast(bytes, from, to, value) {
  for (let i = from; i < to; i++) bytes[i] = value;
  return join(bytes, 0, bytes.length, 1) + Object.keys(bytes).length;
}
function sumWhile(bytes, each) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i] + ",";
    each(i);
  }
  return s + bytes.length;
}
function sumTo(bytes, count, each) {
  let s = "";
  for (let i = 0; i < count; i++) {
    each(i);
    s += bytes[i] + ",";
  }
  return s + bytes.length;
}
function storeWhat(bytes, values) {
  for (let i = 0; i < values.length; i++) bytes[i] = values[i];
  return join(bytes, 0, bytes.length, 1);
}
function find(bytes, wanted) {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === wanted) return i;
  return -1;
}
function nested(rows, bytes) {
  let s = 0;
  for (let r = 0; r < rows; r++) for (let i = 0; i < bytes.length; i++) s = (s + bytes[i] * (r + 1)) | 0;
  return s;
}
function guarded(bytes) {
  let s = 0;
  try {
    for (let i = 0; i < bytes.length; i++) {
      try {
        s += bytes[i];
      } finally {
        s += 1;
      }
    }
  } catch (error) {
    return "caught " + error.constructor.name + " at " + s;
  }
  return s;
}
function* each(bytes) {
  for (let i = 0; i < bytes.length; i++) yield bytes[i];
}
function changing(first, second) {
  let bytes = first;
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i] + ",";
    if (i === 1) bytes = second;
  }
  return s;
}

const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
if (typeof Float16Array === "function") kinds.push(Float16Array);
function receivers() {
  const list = [
    ["array", [1, 2, 3, 250]],
    ["array of doubles", [1.5, 2.5, -0, NaN]],
    ["array with a hole", [1, , 3]],
    ["array of anything", [1, "2", null, { valueOf: () => 4 }]],
    ["empty array", []],
    ["buffer", Buffer.from([1, 2, 3, 250])],
    ["slice of a buffer", Buffer.from([9, 1, 2, 3, 250, 9]).subarray(1, 5)],
    ["empty buffer", Buffer.alloc(0)],
    ["string", "1230"],
    ["string object", new String("12")],
    ["object with a length", { length: 3, 0: 5, 2: 7 }],
    ["arguments", (function () { return arguments; })(4, 5, 6)],
    ["proxy of a view", new Proxy(new Uint8Array([7, 8]), {})],
    ["function", function (a, b) {}],
    ["number", 5],
    ["null", null],
    ["undefined", undefined],
    ["big views", new BigInt64Array([1n, 2n])],
    ["data view", new DataView(new ArrayBuffer(4))],
    ["array buffer", new ArrayBuffer(4)],
  ];
  for (const Kind of kinds) list.push([Kind.name, new Kind([1, 2, 3, 250])], [Kind.name + " at an offset", new Kind(new Kind([9, 1, 2, 3]).buffer, Kind.BYTES_PER_ELEMENT, 2)]);
  return list;
}

for (let round = 0; round < 3; round++) {
  for (const [name, value] of receivers()) {
    say("sum " + name, () => sum(hide(value)));
    say("find " + name, () => find(hide(value), 3));
    say("nested " + name, () => nested(3, hide(value)));
    say("guarded " + name, () => guarded(hide(value)));
    say("each " + name, () => [...each(hide(value))].join());
    say("join around " + name, () => join(hide(value), -2, 6, 1));
    say("join by halves " + name, () => join(hide(value), -1, 3, 0.5));
    say("join far " + name, () => join(hide(value), 4294967294, 4294967298, 1));
    say("join under " + name, () => joinUnder(hide(value), hide([0, -0, 1.5, NaN, Infinity, -1, 4294967296, 2147483648, "1", "01", "-0", "length", 1e21, null, undefined, true])));
  }
  for (const [name, value] of receivers()) {
    say("fill " + name, () => fill(hide(value), 300.7));
  }
  for (const [name, value] of receivers()) {
    say("fill past " + name, () => fillPast(hide(value), -1, 6, -1));
  }
  for (const [name, value] of receivers()) {
    say("store " + name, () => storeWhat(hide(value), hide([1.9, -1.9, NaN, "7", null, undefined, true, { valueOf: () => 258 }, 4294967297, -0])));
  }
  for (const [name, value] of receivers()) say("changing " + name, () => changing(hide(new Uint8Array([1, 2, 3, 4])), hide(value)) + changing(hide(value), hide(new Uint8Array([1, 2, 3, 4]))));
}

function resizable(Kind, count, most) {
  const buffer = new ArrayBuffer(count * Kind.BYTES_PER_ELEMENT, { maxByteLength: most * Kind.BYTES_PER_ELEMENT });
  const tracking = new Kind(buffer);
  for (let i = 0; i < count; i++) tracking[i] = i + 1;
  return buffer;
}
for (let round = 0; round < 3; round++) {
  for (const Kind of [Uint8Array, Int32Array, Float64Array]) {
    const size = Kind.BYTES_PER_ELEMENT;
    const views = [
      ["tracking", buffer => new Kind(buffer)],
      ["tracking at an offset", buffer => new Kind(buffer, 2 * size)],
      ["fixed", buffer => new Kind(buffer, 0, 6)],
      ["fixed at an offset", buffer => new Kind(buffer, 2 * size, 4)],
    ];
    for (const [how, view] of views) {
      const name = Kind.name + " " + how;
      say("shrunk " + name, () => { const b = resizable(Kind, 8, 16); return sumWhile(hide(view(b)), i => { if (i === 2) b.resize(4 * size); }); });
      say("shrunk to nothing " + name, () => { const b = resizable(Kind, 8, 16); return sumWhile(hide(view(b)), i => { if (i === 2) b.resize(0); }); });
      say("shrunk and grown " + name, () => { const b = resizable(Kind, 8, 16); return sumWhile(hide(view(b)), i => { if (i === 1) b.resize(size); if (i === 3) b.resize(12 * size); }); });
      say("grown " + name, () => { const b = resizable(Kind, 8, 16); return sumWhile(hide(view(b)), i => { if (i === 2) b.resize(12 * size); }); });
      say("transferred " + name, () => { const b = resizable(Kind, 8, 16); return sumWhile(hide(view(b)), i => { if (i === 2) b.transfer(); }); });
      say("counted while shrunk " + name, () => { const b = resizable(Kind, 8, 16); return sumTo(hide(view(b)), 8, i => { if (i === 3) b.resize(2 * size); }); });
      say("counted while detached " + name, () => { const b = resizable(Kind, 8, 16); return sumTo(hide(view(b)), 8, i => { if (i === 3) structuredClone(b, { transfer: [b] }); }); });
      say("stored while shrunk " + name, () => { const b = resizable(Kind, 8, 16); return storeWhat(hide(view(b)), hide([1, 2, { valueOf() { b.resize(2 * size); return 3; } }, 4, 5, 6])); });
      say("stored while detached " + name, () => { const b = resizable(Kind, 8, 16); return storeWhat(hide(view(b)), hide([1, 2, { valueOf() { b.transfer(); return 3; } }, 4, 5, 6])); });
    }
    say("detached " + Kind.name, () => { const v = new Kind([1, 2, 3, 4, 5]); return sumWhile(hide(v), i => { if (i === 1) v.buffer.transfer(); }); });
    say("detached before " + Kind.name, () => { const v = new Kind([1, 2, 3, 4, 5]); v.buffer.transfer(); return sum(hide(v)) + join(hide(v), 0, 3, 1) + fillPast(hide(v), 0, 3, 1); });
    say("shared and grown " + Kind.name, () => {
      const b = new SharedArrayBuffer(4 * size, { maxByteLength: 16 * size });
      const v = new Kind(b);
      return sumWhile(hide(v), i => { v[i] = i + 1; if (i === 2) b.grow(7 * size); });
    });
  }
  say("buffer detached", () => { const v = Buffer.from(new ArrayBuffer(6)); v.fill(3); return sumWhile(hide(v), i => { if (i === 1) v.buffer.transfer(); }); });
  say("buffer over a resizable", () => { const b = resizable(Uint8Array, 8, 16); return sumWhile(hide(Buffer.from(b)), i => { if (i === 2) b.resize(3); }); });
}

class OwnLength extends Uint8Array {
  get length() {
    return 2;
  }
}
class LongLength extends Uint8Array {
  get length() {
    return 6;
  }
}
class CountingLength extends Uint8Array {
  reads = 0;
  get length() {
    return ++this.reads > 3 ? 0 : 4;
  }
}
class OtherSpecies extends Uint8Array {
  static get [Symbol.species]() {
    return Array;
  }
}
class BelowBuffer extends Buffer {
  get length() {
    return 1;
  }
}
for (let round = 0; round < 3; round++) {
  say("own length", () => sum(hide(new OwnLength([1, 2, 3, 4]))) + join(hide(new OwnLength([1, 2, 3, 4])), 0, 5, 1));
  say("long length", () => sum(hide(new LongLength([1, 2, 3, 4]))) + fill(hide(new LongLength([1, 2, 3, 4])), 9));
  say("counting length", () => sum(hide(new CountingLength([1, 2, 3, 4]))));
  say("other species", () => sum(hide(new OtherSpecies([1, 2, 3, 4]))) + sum(hide(new OtherSpecies([1, 2, 3, 4]).subarray ? new OtherSpecies([1, 2, 3, 4]) : [])));
  say("length on the instance", () => { const v = new Uint8Array([1, 2, 3, 4]); Object.defineProperty(v, "length", { value: 2 }); return sum(hide(v)) + find(hide(v), 3); });
  say("getter on the instance", () => { const v = Buffer.from([1, 2, 3, 4]); let n = 0; Object.defineProperty(v, "length", { get: () => (n++ < 2 ? 4 : 0) }); return sum(hide(v)); });
  say("length defined in the loop", () => { const v = new Uint8Array([1, 2, 3, 4]); return sumWhile(hide(v), i => { if (i === 0) Object.defineProperty(v, "length", { value: 2, configurable: true }); }); });
  say("prototype of arrays", () => { const v = new Uint8Array([1, 2, 3, 4]); Object.setPrototypeOf(v, Array.prototype); return sum(hide(v)) + join(hide(v), 0, 5, 1); });
  say("no prototype", () => { const v = new Uint8Array([1, 2, 3, 4]); Object.setPrototypeOf(v, null); return sum(hide(v)) + join(hide(v), 0, 5, 1); });
  say("prototype with elements", () => { const v = new Uint8Array([1, 2]); Object.setPrototypeOf(v, { length: 4, 2: "two", 3: "three", "-1": "minus", 1.5: "half" }); return join(hide(v), -1, 4, 0.5); });
  say("prototype swapped in the loop", () => { const v = new Uint8Array([1, 2, 3, 4]); return sumWhile(hide(v), i => { if (i === 1) Object.setPrototypeOf(v, { length: 3 }); }); });
  say("array below a view", () => { const a = [1, , 3]; Object.setPrototypeOf(a, new Uint8Array([7, 8, 9])); return sum(hide(a)) + join(hide(a), 0, 4, 1); });
  say("object below a view", () => { const o = Object.create(new Uint8Array([7, 8, 9])); return guarded(hide(o)) + join(hide(o), 0, 4, 1) + fillPast(hide(o), 0, 4, 1); });
  say("below buffer", () => { const v = Buffer.from([1, 2, 3]); Object.setPrototypeOf(v, BelowBuffer.prototype); return sum(hide(v)); });
  say("sealed", () => fillPast(hide(Object.seal(new Uint8Array([1, 2]))), 0, 4, 5));
  say("not extensible", () => fillPast(hide(Object.preventExtensions(new Uint8Array([1, 2]))), -1, 4, 5));
  say("extra names", () => { const v = new Uint8Array([1, 2]); v.extra = 1; v["1.5"] = 2; v["-0"] = 3; v["01"] = 4; return joinUnder(hide(v), hide(["extra", "1.5", 1.5, "-0", -0, "01", 1])) + Object.keys(v); });
}
console.log(lines.join("\n"));

// GENERATED: each CountingLength [Symbol.species] get
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=undefined|null|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v2 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Less v6, v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b9(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = ElemGet v2, v11
// CHECK-NEXT: v13 = Yield v12, v2
// CHECK-NEXT: v14 = ResultAt v13
// CHECK-NEXT: v15 = ResultAt v13 index=1
// CHECK-NEXT: Switch v15 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v14
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v14
// CHECK-NEXT: b7():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v16 = Increment v11
// CHECK-NEXT: v17 = Convert v16 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v17)
// CHECK-NEXT: b9(v18):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="CountingLength"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_2]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.species]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[f_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Array
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=int[0, 4] flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="n"
// CHECK-NEXT: v3 = ToNumeric v2
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="n"
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_4]]
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = Less v3, v9
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = Integer integer=4
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: Jump -> next b4(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=int[0, 4] flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
