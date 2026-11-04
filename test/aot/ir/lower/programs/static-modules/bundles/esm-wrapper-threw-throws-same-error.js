// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.js
// Bun's `__esm`: what the function throws is kept and thrown by every later call.
var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};
var runs = 0;
var init_bad = __esm(() => {
  runs++;
  throw new Error("no");
});
var attempt = () => {
  try {
    init_bad();
  } catch (error) {
    return error;
  }
};
console.log(attempt() === attempt(), runs);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: __esm attempt
// CHECK-LABEL: function {{*}}name="__esm"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=3 thisType={type=anything} parameters=[{type=undefined|null|number|function flags=[IsExpected]}, {type=anything}, {type=undefined|null|Array flags=[IsExpected]}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|function, v1: anything, v2: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewObject -, v0, v1, v2 layout=[[L_3]] fields=[0, 1, 2]
// CHECK-NEXT: v4 = NewClosure v3 function=[[f_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
