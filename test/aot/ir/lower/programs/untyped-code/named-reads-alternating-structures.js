// RUN: lower
// OPTIONS: builtin-modules

// One name lies at another place in every shape, and the shapes take turns at the same reads.
function hide(value) {
  return JSON.parse(JSON.stringify(value));
}
function shapeWith(name, place, value) {
  const object = {};
  for (let i = 0; i < place; i++) object["filler" + i] = -i;
  object[name] = value;
  object.last = place;
  return object;
}
function readV(object) {
  return object.v;
}
function readThree(object) {
  return [object.v, object.w, object.last].join();
}
function chase(object) {
  let count = 0;
  while (object) {
    count += object.weight;
    object = object.next;
  }
  return count;
}

const shapes = [];
for (const place of [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 31, 32, 63, 64, 65, 100, 253, 254, 255, 256, 257, 300]) shapes.push(shapeWith("v", place, "v at " + place));
let line = [];
for (let turn = 0; turn < 3; turn++) for (const shape of shapes) line.push(readV(shape));
console.log(line.join(" | "));

line = [];
for (let turn = 0; turn < 40; turn++) line.push(readV(shapes[(turn * 7) % shapes.length]) === "v at " + shapes[(turn * 7) % shapes.length].last);
console.log(line.every(Boolean));

const parsed = [hide({ v: 1, w: 2, last: 3 }), hide({ w: 4, v: 5, last: 6 }), hide({ last: 7, w: 8, v: 9 }), hide({ a: 0, b: 0, c: 0, v: 10, last: 11 }), hide({ last: 12 })];
line = [];
for (let turn = 0; turn < 4; turn++) for (const object of parsed) line.push(readThree(object));
console.log(line.join(" | "));

// The place that was right for the last object is past the end of this one.
const small = { v: "small" };
const large = shapeWith("v", 60, "large");
line = [];
for (let turn = 0; turn < 6; turn++) line.push(readV(turn % 2 ? small : large));
console.log(line.join());

// What lies at the guessed place is another property.
const first = { v: "first.v", w: "first.w" };
const second = { w: "second.w", v: "second.v" };
line = [];
for (let turn = 0; turn < 6; turn++) {
  const object = turn % 2 ? first : second;
  line.push(object.v, object.w);
}
console.log(line.join());

// The same object changes under the read.
const changing = { a: 1, v: "before", b: 2 };
line = [readV(changing)];
delete changing.a;
line.push(readV(changing));
changing.a = 3;
line.push(readV(changing));
Object.defineProperty(changing, "v", { get() { return "a getter"; }, configurable: true });
line.push(readV(changing));
Object.defineProperty(changing, "v", { value: "a value again", writable: true, configurable: true });
line.push(readV(changing));
delete changing.v;
line.push(String(readV(changing)));
Object.setPrototypeOf(changing, { v: "inherited" });
line.push(readV(changing));
console.log(line.join());

// What is no ordinary object.
line = [];
for (const receiver of [1, "text", true, Symbol.iterator, 10n, [1, 2], () => 0, new Map(), new Proxy({ v: "through a proxy" }, {}), Object.create(null), Object.freeze({ v: "frozen" }), new (class { v = "a field"; })()]) line.push(String(readV(receiver)));
console.log(line.join());
for (const receiver of [undefined, null]) {
  try {
    readV(receiver);
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}

// A list whose nodes are of three shapes.
let list = null;
for (let i = 0; i < 300; i++) list = i % 3 === 0 ? { weight: i, next: list } : i % 3 === 1 ? { next: list, weight: i } : { id: i, tag: "t", next: list, weight: i };
console.log(chase(list), chase(hide(list)));

// Many reads, so that some share a guess.
const many = [
  object => object.v + '0' + object.last,
  object => object.v + '1' + object.last,
  object => object.v + '2' + object.last,
  object => object.v + '3' + object.last,
  object => object.v + '4' + object.last,
  object => object.v + '5' + object.last,
  object => object.v + '6' + object.last,
  object => object.v + '7' + object.last,
  object => object.v + '8' + object.last,
  object => object.v + '9' + object.last,
  object => object.v + '10' + object.last,
  object => object.v + '11' + object.last,
  object => object.v + '12' + object.last,
  object => object.v + '13' + object.last,
  object => object.v + '14' + object.last,
  object => object.v + '15' + object.last,
  object => object.v + '16' + object.last,
  object => object.v + '17' + object.last,
  object => object.v + '18' + object.last,
  object => object.v + '19' + object.last,
  object => object.v + '20' + object.last,
  object => object.v + '21' + object.last,
  object => object.v + '22' + object.last,
  object => object.v + '23' + object.last,
  object => object.v + '24' + object.last,
  object => object.v + '25' + object.last,
  object => object.v + '26' + object.last,
  object => object.v + '27' + object.last,
  object => object.v + '28' + object.last,
  object => object.v + '29' + object.last,
  object => object.v + '30' + object.last,
  object => object.v + '31' + object.last,
  object => object.v + '32' + object.last,
  object => object.v + '33' + object.last,
  object => object.v + '34' + object.last,
  object => object.v + '35' + object.last,
  object => object.v + '36' + object.last,
  object => object.v + '37' + object.last,
  object => object.v + '38' + object.last,
  object => object.v + '39' + object.last,
  object => object.v + '40' + object.last,
  object => object.v + '41' + object.last,
  object => object.v + '42' + object.last,
  object => object.v + '43' + object.last,
  object => object.v + '44' + object.last,
  object => object.v + '45' + object.last,
  object => object.v + '46' + object.last,
  object => object.v + '47' + object.last,
];
line = [];
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < many.length; i++) line.push(many[i](shapes[(i + turn) % shapes.length]));
console.log(line.join("|").length, line[0], line[47], line[143]);

// GENERATED: hide shapeWith readThree get
// CHECK-LABEL: function {{*}}name="hide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[L_2]]|[[L_3]]|[[L_4]]|[[L_5]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[L_2]]|[[L_3]]|[[L_4]]|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Builtin builtin=JSON
// CHECK-NEXT: v5 = PropGet v4 key="stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v3, v1, v8 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shapeWith"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Data data=[[d_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Less v7, v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v11, v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = String string="filler"
// CHECK-NEXT: v14 = Add v13, v11
// CHECK-NEXT: v15 = Negate v11
// CHECK-NEXT: ElemSet v4, v14, v15
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = Increment v11
// CHECK-NEXT: v18 = Convert v17 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v18)
// CHECK-NEXT: b6(v19, v20):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: ElemSet v4, v0, v2
// CHECK-NEXT: v22 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v22 key="last"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readThree"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="v"
// CHECK-NEXT: v2 = PropGet v0 key="w"
// CHECK-NEXT: v3 = PropGet v0 key="last"
// CHECK-NEXT: v4 = NewArray v1, v2, v3 contents=anything
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v7, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="a getter"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
