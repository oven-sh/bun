// The third parameter of Object.defineProperty is `PropertyDescriptor & ThisType<any>`. The members of an intersection are its properties alone:
// whoever asks them for index signatures stops a build that has debug assertions.
// RUN: lower
// CHECK-LABEL: function {{*}}name="lay"
// CHECK: = New

class Kept {
  constructor(n) {
    this.n = n;
  }
  get value() {
    return 7;
  }
}
export function lay() {
  const kept = new Kept(1);
  return Object.defineProperty({}, "x", kept).x;
}
