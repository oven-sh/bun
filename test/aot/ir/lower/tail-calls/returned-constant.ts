// The source has no tail call here, and Bun's transpiler makes none: it leaves the variable where it is.
// RUN: lower
// CHECK-LABEL: function {{*}}name="annotated"
// CHECK: [[annotatedCall]] = Call
// CHECK-NEXT: [[annotatedExpected]] = Convert [[annotatedCall]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[annotatedValue]] = Convert [[annotatedExpected]] declared={type=number site=[[annotation]]}
// CHECK-NEXT: Return [[annotatedValue]]
// CHECK-LABEL: function {{*}}name="beforeUnreachableStatement"
// CHECK-NOT: ReturnCall
// CHECK: Return [[unreachableValue]]
// CHECK-LABEL: function {{*}}name="declaredWithLet"
// CHECK: [[letCall]] = Call
// CHECK-NEXT: Return [[letCall]]
// CHECK-LABEL: function {{*}}name="declaredWithVar"
// CHECK-NOT: ReturnCall
// CHECK: Return [[varValue]]
// CHECK-LABEL: function {{*}}name="interfaceBetween"
// CHECK: [[interfaceCall]] = Call
// CHECK-NEXT: Return [[interfaceCall]]
// CHECK-LABEL: function {{*}}name="namedOnce"
// CHECK: [[onceCall]] = Call
// CHECK-NEXT: Return [[onceCall]]
// CHECK-LABEL: function {{*}}name="namedTwice"
// CHECK-NOT: ReturnCall
// CHECK: Return [[twiceValue]]
// CHECK-LABEL: function {{*}}name="statementBetween"
// CHECK-NOT: ReturnCall
// CHECK: Return [[betweenValue]]
// CHECK-LABEL: function {{*}}name="throughAnotherConstant"
// CHECK: [[throughCall]] = Call
// CHECK-NEXT: Return [[throughCall]]
// CHECK-LABEL: function {{*}}name="typeAliasBetween"
// CHECK: [[aliasCall]] = Call
// CHECK-NEXT: Return [[aliasCall]]

declare function call2(n: number): unknown;
declare function loose(n: number): any;

export function annotated(n: number) {
  const result: number = loose(n);
  return result;
}

export function beforeUnreachableStatement(n: number) {
  const result = call2(n);
  return result;
  return result;
}

export function declaredWithLet(n: number) {
  let result = call2(n);
  return result;
}

export function declaredWithVar(n: number) {
  var result = call2(n);
  return result;
}

export function interfaceBetween(n: number) {
  const result = call2(n);
  interface Unused {}
  return result;
}

export function namedOnce(n: number) {
  const result = call2(n);
  return result;
}

export function namedTwice(n: number) {
  const result = call2(n);
  call2(result as number);
  return result;
}

export function statementBetween(n: number) {
  const result = call2(n);
  call2(n);
  return result;
}

export function throughAnotherConstant(n: number) {
  const first = call2(n);
  const second = first;
  return second;
}

export function typeAliasBetween(n: number) {
  const result = call2(n);
  type Result = typeof result;
  return result;
}
