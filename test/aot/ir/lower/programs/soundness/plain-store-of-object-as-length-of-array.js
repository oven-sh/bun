// RUN: lower
// OPTIONS: builtin-modules

// A plain store under `length` of an array makes a number of what is stored: `valueOf`, `toString` or `Symbol.toPrimitive` of a stored object runs, twice for each store. soundness/a-counter-is-stale-after-a-built-in-stores-an-object-as-the-length-of-an-array.js has the built-ins that store.
let calls = 0;
const length = { valueOf() { calls++; return 3; } };
const list = [];
list.length = length;
console.log(list.length, calls);
list["len" + "gth"] = length;
console.log(list.length, calls);
console.log((list.length = length) === length, list.length, calls);

function storeUnder(target, key, value) { target[key] = value; return target.length; }
for (const key of ["length", "size", 0]) console.log(String(key), storeUnder([], key, length), calls);

class L extends Array {}
const heir = new L();
heir.length = length;
console.log(heir.length, calls);
heir["len" + "gth"] = length;
console.log(heir.length, calls, heir instanceof L);
console.log(storeUnder(new L(), "length", length), calls);

const text = {};
text.toString = function () { calls++; return "2"; };
list.length = text;
console.log(list.length, calls);
heir.length = text;
console.log(heir.length, calls);

class Count {
  constructor(n) { this.n = n; }
  valueOf() { calls++; return this.n; }
}
list.length = new Count(5);
console.log(list.length, calls);

const hinted = { [Symbol.toPrimitive](hint) { calls++; return hint === "number" ? 4 : 40; } };
list.length = hinted;
console.log(list.length, calls);

function dropTheArray() {
  const quiet = { valueOf() { console.log("valueOf runs"); return 1; } };
  [].length = quiet;
}
dropTheArray();

function dropTheHeir() {
  const late = {};
  late.toString = function () { console.log("toString runs"); return "1"; };
  new L().length = late;
}
dropTheHeir();

function setLength(target, value) { target.length = value; return target.length; }
const record = { length: 0 };
console.log(setLength(record, length) === length, calls);
console.log(setLength([1, 2, 3, 4], length), calls);
let sum = 0;
for (let i = 0; i < 300; i++) sum += i % 3 === 0 ? setLength([], length) : i % 3 === 1 ? setLength(new L(), text) : Number(setLength({}, length) === length);
console.log(sum, calls);

class Failure {
  constructor(why) { this.why = why; }
}
const failing = { valueOf() { throw new Failure("thrown by valueOf"); } };
try { list.length = failing; } catch (error) { console.log(error.why, error instanceof Failure, list.length); }
try { heir["len" + "gth"] = failing; } catch (error) { console.log(error.why, error instanceof Failure, heir.length); }

const changing = { valueOf() { return ++calls; } };
try { list.length = changing; } catch (error) { console.log(error instanceof RangeError, list.length, calls); }
const fraction = { valueOf() { calls++; return 1.5; } };
try { list.length = fraction; } catch (error) { console.log(error instanceof RangeError, list.length, calls); }
const neither = { valueOf() { calls++; return {}; }, toString() { calls++; return []; } };
try { list.length = neither; } catch (error) { console.log(error instanceof TypeError, list.length, calls); }

// GENERATED: storeUnder dropTheArray setLength Count L [Symbol.toPrimitive]
// CHECK-LABEL: function {{*}}name="storeUnder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|number|string flags=[IsExpected]}, {type=undefined|null|number|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|number|string, v2: undefined|null|number|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="length"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dropTheArray"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_2]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_3]]|[[f_4]]|[[f_5]]|[[f_6]]|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v2, v1 key="valueOf"
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Data data=[[d_8]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v7, v8 key="length"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setLength"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|boolean|number|string|symbol|bigint|[[L_1]]|[[L_9]] flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|boolean|number|string|symbol|bigint|[[L_1]]|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: PropSet v0, v1 key="length"
// CHECK-NEXT: v3 = PropGet v0 key="length"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_10]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="n"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="L"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_11]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.toPrimitive]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=int[4, 40] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="calls"
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="calls"
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_12]]
// CHECK-NEXT: v8 = String string="number"
// CHECK-NEXT: v9 = StrictEq v0, v8
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Integer integer=4
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = Integer integer=40
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=int[4, 40] flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
