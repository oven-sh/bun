// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK: [[head]] = NewDictionary
// CHECK: [[called]] = Call {{*}}calleeName="k"
// CHECK-NEXT: [[text]] = Convert [[called]] declared={type=undefined|null|string site=w{{*}}} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: [[key]] = ToPropertyKey [[text]]
// CHECK: [[value]] = Call {{*}}calleeName="v"
// CHECK-NEXT: ElemDefine [[head]], [[key]], [[value]]
// CHECK: PropDefine [[head]], {{*}}key="ab"
// CHECK-NEXT: [[name]] = ToPropertyKey
// CHECK-NEXT: [[closure]] = NewClosure
// CHECK-NEXT: SetFunctionName [[closure]], [[name]]
// CHECK-NEXT: ElemDefine [[head]], [[name]], [[closure]]

// RUN(CONVERSIONS): lower
// CONVERSIONS-COUNT-2: = ToPropertyKey
// CONVERSIONS-NOT: = ToPropertyKey

declare function k(): string;
declare function v(): unknown;

export function create(k2: string) {
  return { [k()]: v(), ["a" + "b"]: 1, [k2]: () => {} };
}
