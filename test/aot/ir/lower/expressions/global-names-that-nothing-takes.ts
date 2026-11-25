// RUN: lower
// CHECK-LABEL: function {{*}}name="leftOfComma"
// CHECK: = PropGet {{*}}key="Date" [isFreeName]
// CHECK-LABEL: function {{*}}name="listed"
// CHECK-NOT: [isFreeName]
// CHECK: Return
// CHECK-LABEL: function {{*}}name="taken"
// CHECK: = PropGet {{*}}key="Date" [isFreeName]
// CHECK: = PropGet {{*}}key="URL" [isFreeName]
// CHECK-LABEL: function {{*}}name="unlisted"
// CHECK: = PropGet {{*}}key="structuredClone" [isFreeName]

// RUN(PLACE): lower
// OPTIONS(PLACE): runs-in-place
// PLACE-LABEL: function {{*}}name="leftOfComma"
// PLACE-NOT: [isFreeName]
// PLACE-LABEL: function {{*}}name="listed"

// Neither `bun build` nor `bun run` reads a free name that the parser lists where nothing takes the value. Both read every other name, and every name whose value something takes.
// Left of a comma whose value is taken `bun build` reads it, unless it minifies. `bun run` minifies.
export function listed() {
  Date; // @ts-expect-error
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

export function leftOfComma() { // @ts-expect-error
  const last = (Date, 1);
  return last;
}
