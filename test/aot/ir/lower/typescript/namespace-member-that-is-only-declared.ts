// RUN: lower
// CHECK-LABEL: function {{*}}name="heading"
// CHECK-NOT: isFreeName
// CHECK: = PropGet {{*}}key="title"
// CHECK: Return

// A name that a namespace exports is a property of the namespace's object, also where the namespace only declares it: other code stores it there.
namespace Tools {
  export declare let title: string;
  export function heading(): string {
    return title + "!";
  }
}

Tools.title = "stored";
export const result = Tools.heading();
