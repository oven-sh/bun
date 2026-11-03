// RUN: lower
// CHECK-LABEL: function {{*}}name="start"
// CHECK: [[port]] = Convert {{*}}declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[head]] = NewObject layout=[[layout]] @
// CHECK-NEXT: PropDefine [[head]], [[port]] key="port"
// CHECK: [[host]] = Convert {{*}}declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropDefine [[head]], [[host]] key="host"
// CHECK-NEXT: = FinishObject [[head]]

// RUN(SITES): lower
// SITES-NOT: site=
// SITES-NOT: illTypedCause=

// The literal is written under a type that a checked file declares. This file is not checked, so what goes into a field is only expected to have the field's type: no position has a site.
import { listen } from "./imports/options";

export function start(read) {
  listen({ port: read(), host: "a" });
}
