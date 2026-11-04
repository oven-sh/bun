// RUN: lower
// OPTIONS: builtin-modules

// Functional style with arrow functions: compose, pipe, curry with rest and spread arguments, closures that return closures, and a recursive flatten.
const compose = (...fns) => value => fns.reduceRight((result, fn) => fn(result), value);
const pipe = (...fns) => value => fns.reduce((result, fn) => fn(result), value);

const curry = fn => {
  const collect = (...args) => (args.length >= fn.length ? fn(...args) : (...more) => collect(...args, ...more));
  return collect;
};

const add = curry((a, b) => a + b);
const multiply = curry((a, b) => a * b);
const clamp = curry((low, high, value) => Math.min(high, Math.max(low, value)));
const prop = name => object => object[name];
const not = test => value => !test(value);
const isEven = value => value % 2 === 0;
const tap = fn => value => (fn(value), value);

function debounceLike(fn) {
  let calls = 0;
  return (...args) => (++calls % 3 === 0 ? fn(...args) : 0);
}

function zipWith(fn, left, right) {
  const out = [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) out.push(fn(left[i], right[i]));
  return out;
}

const flatten = list => list.reduce((out, item) => (Array.isArray(item) ? out.concat(flatten(item)) : (out.push(item), out)), []);

function run(count) {
  let seen = 0;
  const transform = pipe(add(3), multiply(2), clamp(0, 50), tap(() => seen++));
  const back = compose(add(1), multiply(3));
  const everyThird = debounceLike((a, b) => a + b);
  const size = prop("size");
  const items = [{ size: 1 }, { size: 4 }, { size: 9 }];
  const nested = [1, [2, [3, 4]], [5], 6];
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += transform(i & 31) + back(i & 7) + everyThird(i & 3, 1);
    total += size(items[i % 3]) + (not(isEven)(i) ? 1 : 0);
    if ((i & 7) === 0) total += zipWith((a, b) => a * b, [1, 2, 3], [i & 3, 5, 6]).length + flatten(nested).length;
  }
  return total + seen;
}

console.log(run(900000));

// GENERATED: zipWith curry isEven collect
// CHECK-LABEL: function {{*}}name="zipWith"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|Array<number> flags=[IsExpected]}, {type=undefined|null|Array<number> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: undefined|null|Array<number>, v2: undefined|null|Array<number>):
// CHECK-NEXT: v3 = Data data=[[d_1]]
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v5)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Builtin builtin=Math
// CHECK-NEXT: v9 = Builtin builtin=MathMin
// CHECK-NEXT: v10 = PropGet v1 key="length"
// CHECK-NEXT: v11 = PropGet v2 key="length"
// CHECK-NEXT: v12 = Call v9, v8, v10, v11 calleeName="Math.min"
// CHECK-NEXT: v13 = Less v6, v12
// CHECK-NEXT: Branch v13 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v14 = PropGet v3 key="push"
// CHECK-NEXT: v15 = ElemGet v1, v6
// CHECK-NEXT: v16 = ElemGet v2, v6
// CHECK-NEXT: v17 = Call v0, -, v15, v16 calleeName="fn"
// CHECK-NEXT: v18 = Call v14, v3, v17 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v19 = Increment v6
// CHECK-NEXT: v20 = Convert v19 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v20)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="curry"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_2]]|[[f_3]]|[[f_4]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]]|[[f_3]]|[[f_4]]):
// CHECK-NEXT: v1 = NewObject layout=[[L_5]]
// CHECK-NEXT: v2 = NewClosure v1, v0 function=[[f_6]]
// CHECK-NEXT: PutEnvironmentField v1, v2 layout=[[L_5]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isEven"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mod v0, v1
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="collect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] captures=[{type=env [[L_5]] flags=[IsFromCompiler]}, {type=undefined|null|[[f_2]]|[[f_3]]|[[f_4]] flags=[IsExpected] variableName="fn"}] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_5]], v1: undefined|null|[[f_2]]|[[f_3]]|[[f_4]], v2: Array):
// CHECK-NEXT: v3 = PropGet v2 key="length"
// CHECK-NEXT: v4 = PropGet v1 key="length"
// CHECK-NEXT: v5 = GreaterEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v6, v2
// CHECK-NEXT: v8 = CallList v1, -, v6 calleeName="fn"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = NewClosure v0, v2 function=[[f_7]]
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
