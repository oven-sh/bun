// RUN: lower
// The block of an enum is entered with the object that it fills. The name of the enum written in the block is that object, whatever has been stored to the variable since.
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: NewObject
// CHECK: PutModuleVariable {{*}}variable=[[variable]] @
// CHECK: PutModuleVariable [[object]] variable=[[parameter]] @
// CHECK: PropSet [[object]], {{*}}key="Low"
// CHECK-LABEL: function {{*}}name="swap"
// CHECK: PutModuleVariable {{*}}variable=[[variable]] @
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: [[read]] = GetModuleVariable variable=[[parameter]] @
// CHECK: Return [[read]]

export let kept: unknown;
function swap() {
  // @ts-ignore
  Level = { Low: 9 };
  return 1;
}
function keep(it: unknown) {
  kept = () => it;
  return 3;
}
export enum Level {
  Low = swap(),
  High = keep(() => Level),
}
