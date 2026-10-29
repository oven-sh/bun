// RUN: lower
// CHECK-LABEL: function {{*}}name="isNullish"
// CHECK: b0([[x]]: anything):
// CHECK: [[nullish]] = TypeTest [[x]] testedType=undefined|null
// CHECK-NEXT: Return [[nullish]]
// CHECK-LABEL: function {{*}}name="isNumber"
// CHECK: [[number]] = TypeTest [[x]] testedType=number
// CHECK-NEXT: Return [[number]]
// CHECK-LABEL: function {{*}}name="isObject"
// CHECK: [[callable]] = TypeTest [[x]] testedType=function
// CHECK-NEXT: Branch [[callable]] -> taken [[isFunction]](| 0), notTaken [[notFunction]](| 0)
// CHECK: [[notFunction]]([[rest]]):
// CHECK-NEXT: = TypeTest [[rest]] testedType=null|object
// CHECK: [[one]] = Boolean
// CHECK-NEXT: Jump -> next [[join]]([[one]])
// CHECK: [[other]] = Boolean
// CHECK-NEXT: Jump -> next [[join]]([[other]])
// CHECK: [[join]]([[object]]):
// CHECK-NEXT: Return [[object]]
// CHECK-LABEL: function {{*}}name="isString"
// CHECK: [[string]] = TypeTest [[x]] testedType=string
// CHECK-NEXT: Return [[string]]
// CHECK-LABEL: function {{*}}name="isUndefined"
// CHECK: [[undefined]] = TypeTest [[x]] testedType=undefined @
// CHECK-NEXT: Return [[undefined]]
// CHECK-LABEL: function {{*}}name="notFunction"
// CHECK: [[function]] = TypeTest [[x]] testedType=function
// CHECK-NEXT: [[negated]] = LogicalNot [[function]]
// CHECK-NEXT: Return [[negated]]
// CHECK-LABEL: function {{*}}name="nothing"
// CHECK: [[name]] = TypeOf [[x]]
// CHECK: = Eq [[name]],

// RUN(TYPEOF): lower
// TYPEOF-COUNT-1: = TypeOf
// TYPEOF-NOT: = TypeOf

// RUN(NOWHERE): lower
// NOWHERE-NOT: StrictEq

export function isNullish(x: any): any {
  return x == null;
}

export function isNumber(x: any): any {
  return "number" === typeof x;
}

export function isObject(x: any): any {
  return typeof x === "object";
}

export function isString(x: any): any {
  return typeof x === "string";
}

export function isUndefined(x: any): any {
  return x === undefined;
}

export function notFunction(x: any): any {
  return typeof x !== "function";
}

export function nothing(x: any): any {
  return typeof x == ("nothing" as string);
}
