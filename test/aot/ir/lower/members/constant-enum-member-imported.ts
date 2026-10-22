// RUN: lower
// CHECK-LABEL: function {{*}}name="bracket"
// CHECK-NOT: PropGet
// CHECK: = Integer integer=5 @
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="chosen"
// CHECK-NOT: PropGet
// CHECK: Switch {{*}}cases=[0, 5]
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: = ElemGet
// CHECK-LABEL: function {{*}}name="direct"
// CHECK-NOT: GetModuleVariable
// CHECK-NOT: PropGet
// CHECK: = Integer integer=5 @
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="plainEnum"
// CHECK: = GetModuleVariable
// CHECK: = PropGet {{*}}key="One"
// CHECK-LABEL: function {{*}}name="renamed"
// CHECK-NOT: PropGet
// CHECK: = Integer integer=5 @
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="stringMember"
// CHECK-NOT: PropGet
// CHECK: = String string="left"
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="throughNamespace"
// CHECK-NOT: PropGet
// CHECK: = Integer integer=5 @
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="throughStar"
// CHECK-NOT: PropGet
// CHECK: = Integer integer=5 @
// CHECK-NOT: PropGet

import { Kind, Name, Plain } from "./imports/kinds";
import { Kind as ThroughStar, Sort } from "./imports/kinds-again";
import * as all from "./imports/kinds-again";

export function bracket() {
  return Kind["Number"];
}

export function chosen(kind: Kind) {
  switch (kind) {
    case Kind.Word:
      return 1;
    case ThroughStar.Number:
      return 2;
  }
  return 3;
}

export function computed(k: string) {
  return (all as any).Kind[k];
}

export function direct() {
  return Kind.Both;
}

export function plainEnum() {
  return Plain.One;
}

export function renamed() {
  return Sort.Number;
}

export function stringMember() {
  return Name.Left;
}

export function throughNamespace() {
  return all.Kind.Number;
}

export function throughStar() {
  return ThroughStar.Number;
}
