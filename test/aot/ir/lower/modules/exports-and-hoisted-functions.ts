// RUN: link
// CHECK: module {{*}}exports=[{name="early"{{*}}{name="late"{{*}}{name="renamed"{{*}}{name="unread"

// RUN(EARLY): link
// EARLY: variable {{*}}name="early"{{*}}initialization=Function function=f

// RUN(LATE): link
// LATE: variable {{*}}name="late"

// RUN(UNREAD): link
// UNREAD: variable {{*}}name="unread"

// RUN(LOCAL): link
// LOCAL: variable [[local]] name="local"
// LOCAL: module {{*}}{name="renamed" variable=[[local]]}

// RUN(RENAMED): link
// RENAMED-NOT: variable {{*}}name="renamed"

// RUN(BODY): lower
// BODY-LABEL: function {{*}}kind=Module
// BODY-COUNT-3: PutModuleVariable
// BODY-NOT: PutModuleVariable
// BODY: Return

export function early() {
  return late;
}

export const late = 1;
export let unread = 2;
const local = 3;
export { local as renamed };
