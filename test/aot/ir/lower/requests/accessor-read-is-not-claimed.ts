// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=number site=[[result]]}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="level"
// CHECK-NEXT: [[claimed]] = Convert [[read]] declared={type=number site=w{{*}}} illTypedCause=Assertion @
// CHECK-NEXT: Return [[claimed]]

// No slot holds what an accessor returns, so the read is claimed once by what the type of the receiver declares, like a member that is read through an interface
// (member-read-through-an-interface-has-a-site.ts). It is not claimed a second time as a member read, and what is claimed to be a number is not converted again to the result of `f`.
class G {
  get level(): number {
    return 1;
  }
}

export function f(g: G) {
  return g.level;
}
