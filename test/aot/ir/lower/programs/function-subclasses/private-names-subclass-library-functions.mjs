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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="counter"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_4]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_3]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_3]] field=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="is"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_3]] field=3
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_6]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_6]]):
// CHECK-NEXT: v1 = CallDirect v0 function=[[f_7]]
// CHECK-NEXT: ReturnCall v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Numbers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = Data data=[[d_8]]
// CHECK-NEXT: v6 = SuperConstruct v4, v1, v5 layout=[[L_9]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_9]]}
// CHECK-NEXT: v8 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b11(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_10]]
// CHECK-NEXT: v11 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: PrivateSet v14, v15, v2 layout=[[L_9]] field=2
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Jump -> next b9(v19)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: v21 = TypeTest v20 testedType=undefined
// CHECK-NEXT: Branch v21 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v25
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: Jump -> next b9(v26)
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: Return v27
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=DerivedConstructorResult name="Numbers"
// CHECK-NEXT: Throw v29
// CHECK-NEXT: b11(v30):
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v31
// CHECK-NEXT: }
