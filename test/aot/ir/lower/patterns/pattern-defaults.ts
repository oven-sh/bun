// RUN: lower
// CHECK-LABEL: function {{*}}name="arrayDefault"
// CHECK: [[element]] = ResultAt {{*}}index=1
// CHECK-NEXT: [[elementTest]] = TypeTest [[element]] testedType=undefined @
// CHECK-NEXT: Branch [[elementTest]] -> taken [[elementMissing]](| 0), notTaken [[elementPresent]](| 0)
// CHECK: [[elementMissing]]([[absentElement]])
// CHECK-NEXT: Jump -> next [[elementDefault]]()
// CHECK: [[elementDefault]]()
// CHECK-NEXT: [[g]] = Convert {{*}}declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: Jump -> next [[elementCall]]()
// CHECK-NEXT: [[elementCall]]()
// CHECK-NEXT: = Call [[g]] calleeName="g"
// CHECK-LABEL: function {{*}}name="assignedFunction"
// CHECK: [[assigned]] = PropGet {{*}}key="x"
// CHECK-NEXT: = TypeTest [[assigned]] testedType=undefined @
// CHECK-LABEL: function {{*}}name="namedClass"
// CHECK: [[class]] = PropGet {{*}}key="d"
// CHECK: = TypeTest [[class]] testedType=undefined @
// CHECK-LABEL: function {{*}}name="namedFunction"
// CHECK: [[function]] = PropGet {{*}}key="c"
// CHECK: = TypeTest [[function]] testedType=undefined @
// CHECK-LABEL: function {{*}}name="objectDefault"
// CHECK: [[read]] = PropGet {{*}}key="a"
// CHECK: [[test]] = TypeTest [[read]] testedType=undefined @
// CHECK-NEXT: Branch [[test]] -> taken [[missing]](| 0), notTaken [[present]](| 0)
// CHECK: [[missing]]([[absent]]):
// CHECK-NEXT: Jump -> next [[default]]()
// CHECK: [[default]]():
// CHECK-NEXT: [[f]] = Convert {{*}}declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[computed]] = Call [[f]] calleeName="f"
// CHECK-NEXT: Jump -> next [[join]]([[computed]])

// RUN(PRESENT): lower
// PRESENT-LABEL: function {{*}}name="objectDefault"
// PRESENT: [[test]] = TypeTest {{*}}testedType=undefined @
// PRESENT-NEXT: Branch [[test]] -> taken {{*}}(| 0), notTaken [[present]](| 0)
// PRESENT: [[present]]([[value]]):
// PRESENT-NEXT: Jump -> next [[join]]([[value]])

// RUN(ARROW): lower
// ARROW: function {{*}}name="x"{{*}}kind=Arrow

// RUN(CLASS): lower
// CLASS-NOT: function {{*}}name="d"
// CLASS: function {{*}}name="e"
// CLASS-NOT: function {{*}}name="d"

// RUN(FUNCTION): lower
// FUNCTION: function {{*}}name="c"

export function arrayDefault(v: any, g: any) {
  const [b = g()] = v;
  return b;
}

export function assignedFunction(v: any) {
  let x: any;
  ({ x = () => {} } = v);
  return x;
}

export function namedClass(v: any) {
  const { d: e = class {} } = v;
  return e;
}

export function namedFunction(v: any) {
  const { c = function () {} } = v;
  return c;
}

export function objectDefault(v: any, f: any) {
  const { a = f() } = v;
  return a;
}
