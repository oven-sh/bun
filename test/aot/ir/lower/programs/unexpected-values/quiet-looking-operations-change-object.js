// RUN: lower
// OPTIONS: builtin-modules

// Quiet looking operations change an object between two reads.
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Box {
  constructor(width) {
    this.width = width;
    this.height = 4;
  }
}

function OldBox(width) {
  this.width = width;
  this.height = 4;
}

let strike = null;

function hit() {
  if (strike) strike();
}

const trap = {
  valueOf() { hit(); return 1; },
  toString() { hit(); return "key"; },
  toJSON() { hit(); return 1; },
  get member() { hit(); return 1; },
  set member(value) { hit(); },
  [Symbol.iterator]() { hit(); return [][Symbol.iterator](); },
  [Symbol.hasInstance]() { hit(); return true; },
  get then() { hit(); return undefined; },
};
const proxy = new Proxy({}, {
  has() { hit(); return true; },
  get() { hit(); return 1; },
  set() { hit(); return true; },
  deleteProperty() { hit(); return true; },
  ownKeys() { hit(); return []; },
  getPrototypeOf() { hit(); return null; },
});
const callable = new Proxy(function () {}, { apply() { hit(); }, construct() { hit(); return {}; } });

const operations = [
  ["nothing", box => { const a = box.width; return [a, box.width]; }],
  ["+trap", box => { const a = box.width; const b = +trap; return [a, box.width, typeof b]; }],
  ["trap + 1", box => { const a = box.width; const b = trap + 1; return [a, box.width, typeof b]; }],
  ["trap < 2", box => { const a = box.width; const b = trap < 2; return [a, box.width, typeof b]; }],
  ["trap == 1", box => { const a = box.width; const b = trap == 1; return [a, box.width, typeof b]; }],
  ["trap | 0", box => { const a = box.width; const b = trap | 0; return [a, box.width, typeof b]; }],
  ["a template", box => { const a = box.width; const b = `${trap}`; return [a, box.width, typeof b]; }],
  ["String(trap)", box => { const a = box.width; const b = String(trap); return [a, box.width, typeof b]; }],
  ["trap as a key", box => { const a = box.width; const b = ({})[trap]; return [a, box.width, typeof b]; }],
  ["trap as a key of the box", box => { const a = box.width; const b = box[trap]; return [a, box.width, typeof b]; }],
  ["trap.member", box => { const a = box.width; const b = trap.member; return [a, box.width, typeof b]; }],
  ["trap.member = 1", box => { const a = box.width; const b = trap.member = 1; return [a, box.width, typeof b]; }],
  ["{ member } = trap", box => { const a = box.width; const { member } = trap; return [a, box.width]; }],
  ["{ ...trap }", box => { const a = box.width; const b = ({ ...trap }); return [a, box.width, typeof b]; }],
  ["[...trap]", box => { const a = box.width; const b = [...trap]; return [a, box.width, typeof b]; }],
  ["for of trap", box => { const a = box.width; for (const each of trap); return [a, box.width]; }],
  ["[] = trap", box => { const a = box.width; const [] = trap; return [a, box.width]; }],
  ["1 instanceof trap", box => { const a = box.width; const b = 1 instanceof trap; return [a, box.width, typeof b]; }],
  ["JSON.stringify(trap)", box => { const a = box.width; const b = JSON.stringify(trap); return [a, box.width, typeof b]; }],
  ["Object.assign({}, trap)", box => { const a = box.width; const b = Object.assign({}, trap); return [a, box.width, typeof b]; }],
  ["Math.max(trap)", box => { const a = box.width; const b = Math.max(trap); return [a, box.width, typeof b]; }],
  ["[trap].join()", box => { const a = box.width; const b = [trap].join(); return [a, box.width, typeof b]; }],
  ["'x'.repeat(trap)", box => { const a = box.width; const b = "x".repeat(trap); return [a, box.width, typeof b]; }],
  ["[1, 2].at(trap)", box => { const a = box.width; const b = [1, 2].at(trap); return [a, box.width, typeof b]; }],
  ["Promise.resolve(trap)", box => { const a = box.width; const b = Promise.resolve(trap); return [a, box.width, typeof b]; }],
  ["'x' in proxy", box => { const a = box.width; const b = "x" in proxy; return [a, box.width, typeof b]; }],
  ["proxy.x", box => { const a = box.width; const b = proxy.x; return [a, box.width, typeof b]; }],
  ["proxy.x = 1", box => { const a = box.width; const b = proxy.x = 1; return [a, box.width, typeof b]; }],
  ["delete proxy.x", box => { const a = box.width; const b = delete proxy.x; return [a, box.width, typeof b]; }],
  ["Object.keys(proxy)", box => { const a = box.width; const b = Object.keys(proxy); return [a, box.width, typeof b]; }],
  ["for in proxy", box => { const a = box.width; for (const name in proxy); return [a, box.width]; }],
  ["proxy instanceof Box", box => { const a = box.width; const b = proxy instanceof Box; return [a, box.width, typeof b]; }],
  ["callable()", box => { const a = box.width; const b = callable(); return [a, box.width, typeof b]; }],
  ["new callable()", box => { const a = box.width; const b = new callable(); return [a, box.width, typeof b]; }],
  ["a tagged template", box => { const a = box.width; const b = callable``; return [a, box.width, typeof b]; }],
];

const strikes = [
  ["stores a string", box => { box.width = "struck"; }],
  ["deletes width", box => { delete box.width; }],
  ["turns width into a getter", box => { Object.defineProperty(box, "width", { get: () => "getter", configurable: true }); }],
];

for (let i = 0; i < 2000; i++) for (const [, operation] of operations) operation(i % 2 ? new Box(3) : new OldBox(3));

for (const [kind, make] of [["class", () => new Box(3)], ["constructor function", () => new OldBox(3)]]) {
  for (const [label, operation] of operations) {
    const results = strikes.map(([strikeLabel, change]) => {
      const box = make();
      strike = () => change(box);
      let result;
      try {
        result = show(operation(box));
      } catch (error) {
        result = "threw " + error.constructor.name;
      }
      strike = null;
      return strikeLabel + " " + result;
    });
    console.log(kind + " | " + label + " | " + results.join(" | "));
  }
}

// GENERATED: OldBox Box member [Symbol.iterator] has strike
// CHECK-LABEL: function {{*}}name="OldBox"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v1 key="width"
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=4
// CHECK-NEXT: PropSet v4, v5 key="height"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="width"
// CHECK-NEXT: v7 = Convert v4 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer integer=4
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v7, v9 key="height"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="member"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = Call v0 calleeName="hit"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="member"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = Call v1 calleeName="hit"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_5]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = Call v0 calleeName="hit"
// CHECK-NEXT: v2 = Data data=[[d_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key=@@iterator
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|[[L_5]]|Generator flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=true flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = Call v0 calleeName="hit"
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = Convert v2 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="strike"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=undefined|null|string|[[f_9]] flags=[IsExpected]}, {type=anything}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[f_9]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="change"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
