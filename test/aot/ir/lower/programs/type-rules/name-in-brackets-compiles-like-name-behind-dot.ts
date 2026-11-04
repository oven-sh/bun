// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = PropGet [[point]] key="y"
// CHECK: = PropGet [[point]] key="y"
// CHECK: [[bracketed]] = PropGet [[holder]] key="inner"
// CHECK-NEXT: = PropGet [[bracketed]] key="value"
// CHECK: [[dotted]] = PropGet [[holder]] key="inner"
// CHECK-NEXT: = PropGet [[dotted]] key="value"
// CHECK: DefineMethod {{*}}key=@@iterator
// CHECK-LABEL: function {{*}}name="leaves"
// CHECK: = Call {{*}}calleeKey="exit" calleeName="process.exit"
// CHECK-LABEL: function {{*}}name="collects"
// CHECK: = Call {{*}}calleeKey="push" calleeName="list.push"

// `a["b"]` compiles to what `a.b` compiles to. TypeScript has other type errors for one spelling than for the other, and a build reports none of them.
const point = { x: 1 };
console.log(point["y"]);
console.log(point.y);

const holder: { inner?: { value: number } } = {};
console.log(holder["inner"].value);
console.log(holder.inner.value);

function leaves(count: number): number {
  if (count > 0) return 1;
  process["exit"](1);
}

function collects() {
  const list = [];
  list["push"](1);
  return list;
}

class Steps {
  *[Symbol["iterator"]]() {
    yield 1;
  }
}
for (const step of new Steps()) console.log(step);

class Box {
  private hidden = 3;
}
console.log(new Box().hidden, leaves(1), collects());
