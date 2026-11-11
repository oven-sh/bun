// RUN: lower
// CHECK-LABEL: function {{*}}name="bothLinks"
// CHECK: b0([[o]]: anything, [[x]]: anything):
// CHECK: [[bothObjectTest]] = TypeTest [[o]] testedType=undefined|null
// CHECK-NEXT: Branch [[bothObjectTest]] -> taken {{*}}, notTaken [[bothRead]](| 0)
// CHECK: [[bothRead]]([[bothObject]]):
// CHECK-NEXT: [[bothMethodRead]] = PropGet [[bothObject]] key="m"
// CHECK-NEXT: [[bothMethodTest]] = TypeTest [[bothMethodRead]] testedType=undefined|null
// CHECK-NEXT: Branch [[bothMethodTest]] -> taken {{*}}, notTaken [[bothCall]](| 0)
// CHECK: [[bothCall]]([[bothMethod]]):
// CHECK-NEXT: = Call [[bothMethod]], [[bothObject]], [[x]] calleeKey="m" calleeName="o?.m"
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: b0([[o]]: anything, [[k]]: anything, [[argument]]: anything):
// CHECK: [[computedTest]] = TypeTest [[o]] testedType=undefined|null
// CHECK-NEXT: Branch [[computedTest]] -> taken {{*}}, notTaken [[computedRead]](| 0)
// CHECK: [[computedRead]]([[computedObject]]):
// CHECK-NEXT: [[computedMethod]] = ElemGet [[computedObject]], [[k]]
// CHECK-NEXT: = Call [[computedMethod]], [[computedObject]], [[argument]]
// CHECK-NOT: calleeKey
// CHECK-LABEL: function {{*}}name="optionalCall"
// CHECK: b0([[f]]: anything,
// CHECK-NOT: = Call
// CHECK: [[calleeTest]] = TypeTest [[f]] testedType=undefined|null
// CHECK-NEXT: Branch [[calleeTest]] -> taken {{*}}, notTaken [[callBlock]](| 0)
// CHECK: [[callBlock]]([[callee]]):
// CHECK-NEXT: [[made]] = Call [[x]] calleeName="x"
// CHECK-NEXT: = Call [[callee]], -, [[made]] calleeName="f"
// CHECK-LABEL: function {{*}}name="optionalMethod"
// CHECK: [[methodRead]] = PropGet [[o]] key="m"
// CHECK-NEXT: [[methodTest]] = TypeTest [[methodRead]] testedType=undefined|null
// CHECK-NEXT: Branch [[methodTest]] -> taken {{*}}, notTaken [[methodCall]](| 0)
// CHECK: [[methodCall]]([[method]]):
// CHECK-NEXT: = Call [[method]], [[o]], [[x]] calleeKey="m" calleeName="o.m"
// CHECK-LABEL: function {{*}}name="optionalReceiver"
// CHECK: [[receiverTest]] = TypeTest [[o]] testedType=undefined|null
// CHECK-NEXT: Branch [[receiverTest]] -> taken {{*}}, notTaken [[receiverRead]](| 0)
// CHECK: [[receiverRead]]([[receiver]]):
// CHECK-NEXT: [[receiverMethod]] = PropGet [[receiver]] key="m"
// CHECK-NEXT: = Call [[receiverMethod]], [[receiver]], [[x]] calleeKey="m" calleeName="o?.m"
// CHECK-LABEL: function {{*}}name="parenthesized"
// CHECK: [[skipped]] = Undefined
// CHECK-NEXT: Jump -> next [[join]]([[skipped]], [[skipped]])
// CHECK: [[join]]([[function]], [[this]]):
// CHECK-NEXT: = Call [[function]], [[this]], [[x]] calleeName="(o?.m)"
// CHECK-NOT: calleeKey

// RUN(EXITS): lower
// EXITS-LABEL: function {{*}}name="bothLinks"
// EXITS-COUNT-1: = Undefined
// EXITS-NOT: = Undefined
// EXITS: Return
// EXITS-LABEL: function {{*}}name="computed"
// EXITS-COUNT-1: = Undefined
// EXITS-NOT: = Undefined
// EXITS: Return
// EXITS-LABEL: function {{*}}name="optionalCall"
// EXITS-COUNT-1: = Undefined
// EXITS-NOT: = Undefined
// EXITS: Return
// EXITS-LABEL: function {{*}}name="optionalMethod"
// EXITS-COUNT-1: = Undefined
// EXITS-NOT: = Undefined
// EXITS: Return
// EXITS-LABEL: function {{*}}name="optionalReceiver"
// EXITS-COUNT-1: = Undefined
// EXITS-NOT: = Undefined
// EXITS: Return
// EXITS-LABEL: function {{*}}name="parenthesized"
// EXITS-COUNT-1: = Undefined
// EXITS-NOT: = Undefined
// EXITS: Return

export function bothLinks(o: any, x: any): any {
  const result = o?.m?.(x);
  return result;
}

export function computed(o: any, k: any, x: any): any {
  const result = o?.[k](x);
  return result;
}

export function optionalCall(f: any, x: any): any {
  const result = f?.(x());
  return result;
}

export function optionalMethod(o: any, x: any): any {
  const result = o.m?.(x);
  return result;
}

export function optionalReceiver(o: any, x: any): any {
  const result = o?.m(x);
  return result;
}

export function parenthesized(o: any, x: any): any {
  const result = (o?.m)(x);
  return result;
}
