// RUN(FUNCTION): lower
// FUNCTION-LABEL: function {{*}}name="inFunction" {{*}}HasThis
// FUNCTION: b0([[this]]
// FUNCTION: = Call {{*}}, [[this]] calleeName="jsxDEV"

// RUN(OUTER): lower
// OUTER-LABEL: function {{*}}name="aroundArrow" {{*}}HasThis
// OUTER: b0([[this]]
// OUTER: = NewClosure [[this]] function=

// RUN(ARROW): lower
// ARROW-LABEL: function {{*}}kind=Arrow
// ARROW-NOT: HasThis
// ARROW: b0([[this]]
// ARROW: = Call {{*}}, [[this]] calleeName="jsxDEV"

// RUN(FIELD): lower
// FIELD-LABEL: function {{*}}kind=Initializer {{*}}HasThis
// FIELD: b0([[this]]
// FIELD: = Call {{*}}, [[this]] calleeName="jsxDEV"

// RUN(MODULE): lower
// MODULE-LABEL: function {{*}}kind=Module
// MODULE-NOT: HasThis
// MODULE: b0():
// MODULE: = Boolean @
// MODULE-NEXT: [[source]] = Undefined
// MODULE-NEXT: [[this]] = Undefined
// MODULE-NEXT: = Call {{*}}, [[source]], [[this]] calleeName="jsxDEV"

export function inFunction() {
  return <a />;
}

export function aroundArrow() {
  return () => <a />;
}

export class C {
  field = <a />;
}

export const atTopLevel = <a />;
