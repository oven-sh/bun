// RUN: lower
// OPTIONS: builtin-modules

// What a closure keeps between its calls belongs to the call of the factory that made it.
function memoize(compute) {
  const known = new Map();
  let misses = 0;
  return function (key) {
    if (!known.has(key)) {
      misses++;
      known.set(key, compute(key));
    }
    return [known.get(key), misses];
  };
}

function counter(start) {
  let count = start;
  return () => count++;
}

const lazy = make => {
  let value,
    made = false;
  return () => (made ? value : ((made = true), (value = make())));
};

const square = memoize(n => n * n);
const shout = memoize(text => text.toUpperCase());
const list = memoize(n => [n]);
console.log(square(3), square(3), square(4), shout("a"), shout("a"), shout("b"), list(1), list(1)[0] === list(1)[0]);

const fromZero = counter(0);
const fromTen = counter(10);
const fromText = counter("x");
console.log(fromZero(), fromZero(), fromTen(), fromZero(), fromTen(), fromText(), fromText());

let runs = 0;
const number = lazy(() => ++runs);
const object = lazy(() => ({ runs: ++runs }));
const nothing = lazy(() => void ++runs);
console.log(number(), number(), object(), object() === object(), nothing(), nothing(), runs);

// GENERATED: memoize counter lazy
// CHECK-LABEL: function {{*}}name="memoize"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: v1 = NewObject layout=[[L_1]]
// CHECK-NEXT: v2 = Builtin builtin=Map
// CHECK-NEXT: v3 = Construct v2 calleeName="Map"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v5 layout=[[L_1]]
// CHECK-NEXT: v7 = NewClosure v1, v0, v3 function=[[f_2]]
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: v1 = NewObject layout=[[L_3]]
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v2 layout=[[L_3]]
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lazy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: v1 = NewObject layout=[[L_5]]
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: PutEnvironmentField v1, v2 layout=[[L_5]]
// CHECK-NEXT: v4 = Boolean
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v5 layout=[[L_5]] field=1
// CHECK-NEXT: v7 = NewClosure v1, v0 function=[[f_6]]
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
