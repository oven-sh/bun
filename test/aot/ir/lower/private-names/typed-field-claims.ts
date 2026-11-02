// RUN: lower
// CHECK-LABEL: function {{*}}name="set"
// CHECK: b0([[receiver]]: {{*}}, [[w]]: anything):
// CHECK: [[stored]] = Convert [[w]] declared={type=number site=[[field]]} illTypedCause=FromLooseType
// CHECK: PrivateSet [[receiver]], [[token]], [[stored]] layout=
// CHECK-LABEL: function {{*}}name="get"
// CHECK: results=[{type=number site=[[result]]}]
// CHECK: [[read]] = PrivateGet
// CHECK-NEXT: [[returned]] = Convert [[read]] declared={type=number site=[[result]]} @
// CHECK-NEXT: Return [[returned]]
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: [[initial]] = Convert {{*}}declared={type=number site=[[field]]} illTypedCause=FromLooseType
// CHECK: PrivateDefine {{*}}, [[initial]] layout={{*}}field=1 @

declare const v: any;

export class C {
  #x: number = v;
  set(w: any) {
    this.#x = w;
  }
  get() {
    return this.#x;
  }
}
