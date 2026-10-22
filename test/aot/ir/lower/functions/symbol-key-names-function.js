// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[wellKnown]] = NewClosure function=
// CHECK-NEXT: [[head]] = NewObject
// CHECK-NEXT: PropDefine [[head]], [[wellKnown]] key=@@iterator
// CHECK: PropDefine {{*}}key="plain"
// CHECK: [[made]] = NewClosure function=
// CHECK: SetFunctionName [[made]], {{*}}

// RUN(ONCE): lower
// ONCE-COUNT-1: SetFunctionName
// ONCE-NOT: SetFunctionName

// RUN(NAMED): lower
// NAMED-NOT: function {{*}}name=
// NAMED: function {{*}}name="[Symbol.iterator]" {{*}}IsNamedBySymbol
// NAMED-NOT: function {{*}}name=
// NAMED: function {{*}}name="plain"
// NAMED-NOT: function {{*}}name=

// A function under a symbol has no name of its own: it gets the property `name` and nothing else, so the console prints `[Function]`. Under a symbol that the program makes SetFunctionName gives it the property.
// Under a well-known symbol the text is known when the program is compiled: it stands in the header, marked IsNamedBySymbol, and nothing runs for it when the literal is evaluated.
const own = Symbol("own");

export const o = {
  [Symbol.iterator]() {},
  plain() {},
  [own]() {},
};
