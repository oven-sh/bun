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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|string|Array flags=[IsExpected]}, {type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=undefined|null|Array flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: undefined|null|string|Array, v2: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Data data=[[d_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v7)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = Builtin builtin=Math
// CHECK-NEXT: v11 = Builtin builtin=MathMin
// CHECK-NEXT: v12 = PropGet v1 key="length"
// CHECK-NEXT: v13 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v2 key="length"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v11, v10, v13, v15 calleeName="Math.min"
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v18 = Less v8, v17
// CHECK-NEXT: Branch v18 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v19):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v20 = PropGet v5 key="push"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v22 = ElemGet v1, v19
// CHECK-NEXT: v23 = ElemGet v2, v19
// CHECK-NEXT: v24 = Call v0, -, v22, v23 calleeName="fn"
// CHECK-NEXT: v25 = Call v21, v5, v24 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v26 = Increment v19
// CHECK-NEXT: v27 = Convert v26 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v27)
// CHECK-NEXT: b6(v28):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="curry"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|[[f_3]] flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_5]]
// CHECK-NEXT: v2 = NewClosure v1, v0 function=[[f_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isEven"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mod v1, v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="collect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] captures=[{type=env [[L_5]] flags=[IsFromCompiler]}, {type=undefined|null|function flags=[IsExpected]}] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|[[f_8]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_5]], v1: undefined|null|function, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v2 key="length"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v1 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v7 = GreaterEq v4, v6
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v8, v2
// CHECK-NEXT: v10 = CallList v1, -, v8 calleeName="fn"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|[[f_8]] flags=[IsExpected]}}]
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = NewClosure v0, v2 function=[[f_9]]
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
