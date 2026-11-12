// RUN: lower
// OPTIONS: builtin-modules

// Each function has one call of Object.create. The first object that the call is handed is a literal, null, a proxy, a function, an array, the prototype object of a class, of a constructor
// function or of a built-in class, an object that Object.create made, a frozen literal, or no object at all; later calls are handed the others.
const log = [];
class Shape { area() { return "area of " + this.name; } get name2() { return this.name + "!"; } }
function Old() {}
Old.prototype.area = function () { return "old area of " + this.name; };
const literal = { area() { return "literal area of " + this.name; }, get name2() { return this.name + "?"; } };
const handed = {
  literal: () => literal,
  nothing: () => null,
  proxy: () => new Proxy(literal, { get(target, key, receiver) { return key === "area" ? () => "trapped" : Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push("set trap " + String(key)); return Reflect.set(target, key, value, receiver); } }),
  function: () => function named() {},
  array: () => [1, 2, 3],
  classPrototype: () => Shape.prototype,
  oldPrototype: () => Old.prototype,
  builtinPrototype: () => Map.prototype,
  created: () => Object.create(literal),
  frozen: () => Object.freeze({ area() { return "frozen area"; }, name: "frozen name" }),
  number: () => 7,
  undefined: () => undefined,
  string: () => "text",
};
const makers = [
  above => { const made = Object.create(above); made.name = "a"; made.extra = 1; return made; },
  above => { const made = Object.create(above); made.name = "b"; made.extra = 2; return made; },
  above => { const made = Object.create(above); made.name = "c"; made.extra = 3; return made; },
  above => { const made = Object.create(above); made.name = "d"; made.extra = 4; return made; },
  above => { const made = Object.create(above); made.name = "e"; made.extra = 5; return made; },
  above => { const made = Object.create(above); made.name = "f"; made.extra = 6; return made; },
  above => { const made = Object.create(above); made.name = "g"; made.extra = 7; return made; },
  above => { const made = Object.create(above); made.name = "h"; made.extra = 8; return made; },
  above => { const made = Object.create(above); made.name = "i"; made.extra = 9; return made; },
  above => { const made = Object.create(above); made.name = "j"; made.extra = 10; return made; },
  above => { const made = Object.create(above); made.name = "k"; made.extra = 11; return made; },
  above => { const made = Object.create(above); made.name = "l"; made.extra = 12; return made; },
  above => { const made = Object.create(above); made.name = "m"; made.extra = 13; return made; },
];
function look(made) {
  let answer = typeof made.area === "function" ? made.area() : String(made.area);
  answer += " | " + made.name + " | " + made.name2 + " | " + made.extra + " | " + made.length + " | " + Object.keys(made).join();
  answer += " | " + (Object.getPrototypeOf(made) === null ? "null" : typeof Object.getPrototypeOf(made)) + " | " + (made instanceof Shape) + (made instanceof Old) + " | " + typeof made.toString;
  return answer;
}
const names = Object.keys(handed);
makers.forEach((make, first) => {
  for (let step = 0; step < names.length * 2; step++) {
    const name = names[(first + step) % names.length];
    try {
      const above = handed[name]();
      const made = make(above);
      log.push(first + " " + name + ": " + look(made) + " | " + (Object.getPrototypeOf(made) === above));
    } catch (error) {
      log.push(first + " " + name + ": " + error.constructor.name + ": " + error.message);
    }
  }
});
console.log(log.join("\n"));

// GENERATED: Shape builtinPrototype created frozen get set
// CHECK-LABEL: function {{*}}name="Shape"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="builtinPrototype"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=MapPrototype
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="created"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="literal"
// CHECK-NEXT: v4 = Call v1, v0, v3 calleeName="Object.create"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="frozen"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectFreeze
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="frozen name"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"frozen name" flags=[IsExpected]}
// CHECK-NEXT: v6 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v6, v3 key="area"
// CHECK-NEXT: PropDefine v6, v5 key="name"
// CHECK-NEXT: v9 = FinishObject v6
// CHECK-NEXT: v10 = Call v1, v0, v9 calleeName="Object.freeze"
// CHECK-NEXT: ReturnCall v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]], v1: undefined|null|string|symbol, v2: anything):
// CHECK-NEXT: v3 = String string="area"
// CHECK-NEXT: v4 = StrictEq v1, v3
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = NewClosure function=[[f_7]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = Builtin builtin=Reflect
// CHECK-NEXT: v7 = Builtin builtin=ReflectGet
// CHECK-NEXT: v8 = Call v7, v6, v0, v1, v2 calleeName="Reflect.get"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]], v1: undefined|null|string|symbol, v2: anything, v3: anything):
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="log"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = String string="set trap "
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = Call v8, -, v1 calleeName="String"
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Call v6, v5, v10 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v12 = Builtin builtin=Reflect
// CHECK-NEXT: v13 = Builtin builtin=ReflectSet
// CHECK-NEXT: v14 = Call v13, v12, v0, v1, v2, v3 calleeName="Reflect.set"
// CHECK-NEXT: ReturnCall v14
// CHECK-NEXT: }
