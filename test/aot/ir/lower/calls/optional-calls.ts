// RUN: lower
// CHECK-LABEL: function {{*}}name="bothLinks"
// CHECK: b0([[o]]: anything, [[x]]: anything):
// CHECK: [[convertedO]] = Convert [[o]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[bothObjectTest]] = TypeTest [[convertedO]] testedType=undefined|null
// CHECK-NEXT: Branch [[bothObjectTest]] -> taken {{*}}, notTaken [[bothRead]](| 0)
// CHECK: [[bothRead]]([[bothObject]]):
// CHECK-NEXT: [[bothMethodRead]] = PropGet [[bothObject]] key="m"
// CHECK-NEXT: [[convertedBothMethodRead]] = Convert [[bothMethodRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[bothMethodTest]] = TypeTest [[convertedBothMethodRead]] testedType=undefined|null
// CHECK-NEXT: Branch [[bothMethodTest]] -> taken {{*}}, notTaken [[bothCall]](| 0)
// CHECK: [[bothCall]]([[bothMethod]]):
// CHECK-NEXT: = Call [[bothMethod]], [[bothObject]], [[x]] calleeKey="m" calleeName="o?.m"
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: b0([[o]]: anything, [[k]]: anything, [[argument]]: anything):
// CHECK: [[computedReceiver]] = Convert [[o]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: [[computedTest]] = TypeTest [[computedReceiver]] testedType=undefined|null
// CHECK-NEXT: Branch [[computedTest]] -> taken {{*}}, notTaken [[computedRead]](| 0)
// CHECK: [[computedRead]]([[computedObject]]):
// CHECK-NEXT: [[computedMethod]] = ElemGet [[computedObject]], [[k]]
// CHECK-NEXT: [[convertedComputedMethod]] = Convert [[computedMethod]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[convertedComputedMethod]], [[computedObject]], [[argument]]
// CHECK-NOT: calleeKey
// CHECK-LABEL: function {{*}}name="optionalCall"
// CHECK: b0([[f]]: anything,
// CHECK-NOT: = Call
// CHECK: [[convertedF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[calleeTest]] = TypeTest [[convertedF]] testedType=undefined|null
// CHECK-NEXT: Branch [[calleeTest]] -> taken {{*}}, notTaken [[callBlock]](| 0)
// CHECK: [[callBlock]]([[callee]]):
// CHECK-NEXT: [[convertedX]] = Convert [[x]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[made]] = Call [[convertedX]] calleeName="x"
// CHECK-NEXT: = Call [[callee]], -, [[made]] calleeName="f"
// CHECK-LABEL: function {{*}}name="optionalMethod"
// CHECK: [[methodObject]] = Convert [[o]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[methodRead]] = PropGet [[methodObject]] key="m"
// CHECK-NEXT: [[convertedMethodRead]] = Convert [[methodRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[methodTest]] = TypeTest [[convertedMethodRead]] testedType=undefined|null
// CHECK-NEXT: Branch [[methodTest]] -> taken {{*}}, notTaken [[methodCall]](| 0)
// CHECK: [[methodCall]]([[method]]):
// CHECK-NEXT: = Call [[method]], [[methodObject]], [[x]] calleeKey="m" calleeName="o.m"
// CHECK-LABEL: function {{*}}name="optionalReceiver"
// CHECK: [[convertedReceiver]] = Convert [[o]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[receiverTest]] = TypeTest [[convertedReceiver]] testedType=undefined|null
// CHECK-NEXT: Branch [[receiverTest]] -> taken {{*}}, notTaken [[receiverRead]](| 0)
// CHECK: [[receiverRead]]([[receiver]]):
// CHECK-NEXT: [[receiverMethodRead]] = PropGet [[receiver]] key="m"
// CHECK-NEXT: [[receiverMethod]] = Convert [[receiverMethodRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[receiverMethod]], [[receiver]], [[x]] calleeKey="m" calleeName="o?.m"
// CHECK-LABEL: function {{*}}name="parenthesized"
// CHECK: [[skipped]] = Undefined
// CHECK-NEXT: Jump -> next [[join]]([[skipped]], [[skipped]])
// CHECK: [[join]]([[function]], [[this]]):
// CHECK-NEXT: = Call [[function]], [[this]], [[x]] calleeName="o?.m"
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
