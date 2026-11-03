// RUN(ELEMENT): lower
// ELEMENT-LABEL: function {{*}}name="element"
// ELEMENT: b0([[y]]
// ELEMENT: [[react]] = ModuleNamespace
// ELEMENT: [[createElement]] = PropGet [[react]] key="createElement"
// ELEMENT: [[tag]] = String string="a"
// ELEMENT: [[props]] = FinishObject
// ELEMENT: [[text]] = String string="x"
// ELEMENT: = Call [[createElement]], [[react]], [[tag]], [[props]], [[text]], [[y]] calleeKey="createElement"

// RUN(CHILDREN): lower
// CHILDREN-LABEL: function {{*}}name="element"
// CHILDREN-NOT: key="children"
// CHILDREN: Return

// RUN(FRAGMENT): lower
// FRAGMENT-LABEL: function {{*}}name="fragment"
// FRAGMENT: [[createElement]] = PropGet [[react]] key="createElement"
// FRAGMENT: [[tag]] = PropGet {{*}}key="Fragment"
// FRAGMENT-NOT: = NewObject
// FRAGMENT: [[props]] = Null
// FRAGMENT: = Call [[createElement]], [[react]], [[tag]], [[props]] calleeKey="createElement"

import * as React from "react";

export function element(y: unknown) {
  return <a b={1}>x{y}</a>;
}

export function fragment() {
  return <></>;
}
