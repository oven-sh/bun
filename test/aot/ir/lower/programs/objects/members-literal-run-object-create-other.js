// RUN: lower
// OPTIONS: builtin-modules

// The members of a literal store names through `this`. They run on objects made one and two steps below the literal, on the literal, on unrelated objects and on primitives,
// while the objects above gain, lose and redefine members.
const lines = [];
const stoves = {
  light(logs) {
    let heat = (this.heat ?? 15) + logs * 40;
    while (!this.bears(heat)) {
      heat -= 25;
      this.opened = (this.opened ?? 0) + 1;
    }
    this.heat = heat;
  },
  bears(heat) {
    return !(heat > this.most);
  },
  get most() {
    return this.wall.stone ? 220 : 160;
  },
  get shut() {
    return this.wall.door === "shut";
  },
  get soot() {
    return this.wall.soot;
  },
  set soot(pounds) {
    if (this.shut) return;
    this.wall.soot = pounds % 10;
    if (pounds > 9) this.swept = true;
  },
  burn(hours) {
    for (let hour = 0; hour < hours; hour++) {
      this.soot = this.soot + 4;
      this.heat -= hour;
    }
    return this.heat;
  },
  tell() {
    return `${Object.keys(this)} ${this.heat} ${this.opened} ${this.swept}`;
  },
  kindOfThis() {
    "use strict";
    return typeof this;
  },
};
const newWall = stone => ({ stone, soot: 1 });
class Inn {
  constructor() {
    this.stoves = Object.create(stoves);
  }
  room(stone) {
    const stove = Object.create(this.stoves);
    stove.wall = newWall(stone);
    stove.inn = this;
    return stove;
  }
}
const hidden = process.argv.length > 9 ? "x" : "";
const inn = new Inn();
function evening(stove, logs) {
  stove.light(logs);
  return stove.burn(logs) + " of " + stove.most + ", " + stove.soot + " soot: " + stove.tell();
}
globalThis["evening" + hidden] = evening;
function spend(stove, logs) {
  try {
    return globalThis["evening" + hidden](stove, logs);
  } catch (error) {
    return error.constructor.name + ": " + stoves.tell.call(stove);
  }
}

for (const logs of [1, 4, 7]) lines.push(spend(inn.room(logs > 4), logs));

const kept = inn.room(true);
lines.push(spend(kept, 5), spend(kept, 2), Reflect.ownKeys(kept).join());
kept.wall.door = "shut";
lines.push(spend(kept, 3));

// The order of the names is the order of the stores.
const cleaned = inn.room(false);
cleaned.swept = "by hand";
cleaned.opened = 10;
lines.push(spend(cleaned, 6), JSON.stringify(cleaned, (name, value) => (name === "inn" ? "the inn" : value)));

// One step below, the literal itself, an unrelated object, primitives.
inn.stoves.wall = newWall(true);
lines.push(spend(inn.stoves, 3), Object.keys(inn.stoves).join());
for (const name of Object.keys(inn.stoves)) delete inn.stoves[name];
stoves.wall = newWall(false);
lines.push(spend(stoves, 4), Object.keys(stoves).length, stoves.heat);
for (const name of ["wall", "heat", "opened", "swept"]) delete stoves[name];
const brazier = { light: stoves.light, bears: stoves.bears, burn: stoves.burn, most: 100, wall: newWall(true) };
Object.defineProperty(brazier, "soot", Object.getOwnPropertyDescriptor(stoves, "soot"));
lines.push(spend(brazier, 3), JSON.stringify(brazier), brazier.soot);
lines.push(stoves.kindOfThis.call("s"), stoves.kindOfThis.call(7n), stoves.kindOfThis.call(undefined), stoves.tell.call("ab"));
lines.push(Reflect.get(stoves, "most", { wall: { stone: 1 } }));
try {
  Reflect.set(stoves, "soot", 4, Object.create(null));
} catch (error) {
  lines.push(error instanceof TypeError);
}

// A name that the members store gets an accessor above, then a value, then goes.
const caught = [];
Object.defineProperty(inn.stoves, "heat", {
  get: () => 77,
  set(degrees) {
    caught.push(degrees);
  },
  configurable: true,
});
const under = inn.room(true);
lines.push(spend(under, 3), caught.join(), Object.hasOwn(under, "heat"));
Object.defineProperty(inn.stoves, "heat", { value: 50, writable: false, configurable: true });
const fixed = inn.room(false);
lines.push(spend(fixed, 2), Object.hasOwn(fixed, "heat"));
delete inn.stoves.heat;
lines.push(spend(inn.room(true), 2));

// An accessor of the literal becomes a value, a method is replaced, the link above changes.
Object.defineProperty(stoves, "most", { value: 90, writable: true, configurable: true });
const low = inn.room(true);
lines.push(spend(low, 3), low.most, Object.hasOwn(low, "most"));
stoves.burn = function (hours) {
  this.soot += hours;
  return "embers";
};
lines.push(spend(inn.room(false), 2));
stoves.bears = () => true;
lines.push(spend(inn.room(false), 9));
Object.setPrototypeOf(inn.stoves, { light() { this.heat = "cold"; }, burn: () => 0, set soot(pounds) {}, most: 1, tell: () => "no stove" });
lines.push(spend(inn.room(true), 8));

// Closed, sealed and frozen objects.
Object.setPrototypeOf(inn.stoves, stoves);
for (const close of [Object.seal, Object.preventExtensions, Object.freeze]) {
  const shut = close(inn.room(true));
  lines.push(spend(shut, 5), Object.keys(shut).join());
}
console.log(lines.join("\n"));

// GENERATED: Inn room soot kindOfThis newWall light bears
// CHECK-LABEL: function {{*}}name="Inn"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="stoves"
// CHECK-NEXT: v8 = Call v5, v4, v7 calleeName="Object.create"
// CHECK-NEXT: PropSet v3, v8 key="stoves"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="room"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v3 = PropGet v0 key="stoves"
// CHECK-NEXT: v4 = NewObject layout=[[L_3]]
// CHECK-NEXT: SetLiteralPrototype v4, v3 [refusesOtherValues]
// CHECK-NEXT: v6 = FinishObject v4
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="newWall"
// CHECK-NEXT: v9 = Call v8, -, v1 calleeName="newWall"
// CHECK-NEXT: PropSet v6, v9 key="wall"
// CHECK-NEXT: PropSet v6, v0 key="inn"
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="light"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="heat"
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Integer integer=15
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = Integer integer=40
// CHECK-NEXT: v9 = Mul v1, v8
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = PropGet v0 key="bears"
// CHECK-NEXT: v15 = Call v14, v0, v12 calleeKey="bears" calleeName="this.bears"
// CHECK-NEXT: v16 = ToBoolean v15
// CHECK-NEXT: Branch v16 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v17):
// CHECK-NEXT: PropSet v0, v12 key="heat"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = Integer integer=25
// CHECK-NEXT: v22 = Sub v12, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v0 key="opened"
// CHECK-NEXT: v25 = TypeTest v24 testedType=undefined|null
// CHECK-NEXT: Branch v25 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v26):
// CHECK-NEXT: v27 = Integer
// CHECK-NEXT: Jump -> next b9(v27)
// CHECK-NEXT: b8(v28):
// CHECK-NEXT: Jump -> next b9(v28)
// CHECK-NEXT: b9(v29):
// CHECK-NEXT: v30 = Integer integer=1
// CHECK-NEXT: v31 = Add v29, v30
// CHECK-NEXT: PropSet v0, v31 key="opened"
// CHECK-NEXT: Jump -> next b4(v23)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bears"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="most"
// CHECK-NEXT: v3 = Greater v1, v2
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: v5 = LogicalNot v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="soot"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="wall"
// CHECK-NEXT: v2 = PropGet v1 key="soot"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="soot"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="shut"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = PropGet v0 key="wall"
// CHECK-NEXT: v8 = Integer integer=10
// CHECK-NEXT: v9 = Mod v1, v8
// CHECK-NEXT: PropSet v7, v9 key="soot"
// CHECK-NEXT: v11 = Integer integer=9
// CHECK-NEXT: v12 = Greater v1, v11
// CHECK-NEXT: Branch v12 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v13 = Boolean boolean=true
// CHECK-NEXT: PropSet v0, v13 key="swept"
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kindOfThis"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="newWall"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = NewObject -, v0, v1 layout=[[L_5]] fields=[1, 0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="light"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="cold"
// CHECK-NEXT: PropSet v0, v1 key="heat"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="soot"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
