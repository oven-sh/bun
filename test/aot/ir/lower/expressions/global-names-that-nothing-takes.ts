// RUN: lower
// CHECK-LABEL: function {{*}}name="listed"
// CHECK-NOT: [isFreeName]
// CHECK: Return
// CHECK-LABEL: function {{*}}name="taken"
// CHECK: = PropGet {{*}}key="Date" [isFreeName]
// CHECK: = PropGet {{*}}key="URL" [isFreeName]
// CHECK-LABEL: function {{*}}name="unlisted"
// CHECK: = PropGet {{*}}key="structuredClone" [isFreeName]

// `bun run` does not read a free name that its parser lists where nothing takes the value. It reads every other name, and every name whose value something takes.
export function listed() {
  Date;
  Date, URL;
  [Promise, { when: Date }];
}

export function taken() {
  const when = Date;
  const list = [URL];
}

export function unlisted() {
  structuredClone;
}
