// RUN: lower
// OPTIONS: builtin-modules

// Classes with private state extend functions of Bun's own modules: private fields between public ones, a private method, a private accessor, `accessor`, `#name in`,
// a class below such a class, a private name read by a closure and by a static method, and a second initialization of one object.
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
class Counter extends EventEmitter {
  #count = 0;
  step = 2;
  #limit = 7;
  bump() { if (this.#count < this.#limit) this.#count += this.step; this.emit("count", this.#count); return this; }
  get count() { return this.#count; }
  static is(it) { return #limit in it; }
  static peek(it) { return it.#count + ":" + it.#limit; }
}
class Guarded extends EventEmitter {
  open = true;
  #check() { return this.open ? "open" : "shut"; }
  get #state() { return this.#check() + this.listenerCount("x"); }
  set #state(value) { this.open = value; }
  accessor label = "g";
  toggle() { this.#state = !this.open; return this.#state; }
}
class Deeper extends Counter {
  #own = "deep";
  name = "d";
  describe() { const read = () => this.#own + this.name + this.count; return read(); }
}
class Numbers extends Readable {
  #next = 0;
  #last;
  constructor(last) { super({ objectMode: true }); this.#last = last; }
  _read() { this.push(this.#next < this.#last ? this.#next++ : null); }
}
class Sum extends Writable {
  #total = 0;
  constructor() { super({ objectMode: true }); }
  _write(chunk, encoding, done) { this.#total += chunk; done(); }
  get total() { return this.#total; }
}
const counter = new Counter();
const heard = [];
counter.on("count", n => heard.push(n));
for (let i = 0; i < 6; i++) counter.bump();
console.log(counter.count, heard.join(), Counter.is(counter), Counter.is(new EventEmitter()), Counter.peek(counter), Object.keys(counter).join());
try { Counter.peek(new EventEmitter()); } catch (error) { console.log(error.constructor.name); }
const guarded = new Guarded();
guarded.on("x", () => {});
console.log(guarded.toggle(), guarded.toggle(), guarded.label, Object.keys(guarded).join());
const deeper = new Deeper();
deeper.on("count", n => heard.push(-n));
console.log(deeper.bump().bump().describe(), Counter.is(deeper), Counter.peek(deeper), heard.slice(-2).join(), Object.keys(deeper).join());
let made = 0;
for (let i = 0; i < 2000; i++) made += new Counter().bump().count + new Deeper().bump().describe().length;
console.log(made);
function Same() { return counter; }
Object.setPrototypeOf(Counter, Same);
try { new Counter(); } catch (error) { console.log(error.constructor.name, counter.step, Counter.peek(counter)); }
Object.setPrototypeOf(Counter, EventEmitter);
console.log(new Counter().bump().count);
const sum = new Sum();
sum.on("finish", () => console.log("total", sum.total, Object.keys(sum).filter(key => !key.startsWith("_")).join()));
new Numbers(100).pipe(sum);

// GENERATED: Same Counter count is describe Numbers
// CHECK-LABEL: function {{*}}name="Same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="counter"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_4]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = PrivateGet v1, v2 layout=[[L_1]] field=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="is"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_1]] field=3
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_7]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Call v2
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Numbers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = Data data=[[d_11]]
// CHECK-NEXT: v6 = SuperConstruct v4, v1, v5 layout=[[L_12]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_13]]
// CHECK-NEXT: v11 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12) frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: PrivateSet v15, v16, v2 layout=[[L_12]] field=2
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v23):
// CHECK-NEXT: v24 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v25) frequency=Unlikely:
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: Jump -> next b10(v27)
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b11(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="Numbers"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b12(v31) frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
