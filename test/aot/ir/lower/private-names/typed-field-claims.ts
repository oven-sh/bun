// RUN: lower
// CHECK-LABEL: function {{*}}name="set"
// CHECK: b0([[receiver]]: {{*}}, [[w]]: anything):
// CHECK: [[stored]] = Convert [[w]] declared={type=number} @
// CHECK: PrivateSet [[receiver]], [[token]], [[stored]] layout=
// Nothing is written of the result, and a read of a field is converted to nothing.
// CHECK-LABEL: function {{*}}name="get"
// CHECK: results=[{type=anything}]
// CHECK: [[read]] = PrivateGet
// CHECK-NEXT: Return [[read]]
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: [[initial]] = Convert {{*}}declared={type=number} @
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
