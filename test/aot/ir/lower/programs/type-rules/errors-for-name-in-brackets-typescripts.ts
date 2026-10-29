// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS18048 1
// DIAGNOSTIC: TS2339 1
// DIAGNOSTIC: TS2341 1
// DIAGNOSTIC: TS2366 1
// DIAGNOSTIC: TS2488 1
// DIAGNOSTIC: TS2532 1
// DIAGNOSTIC: TS7005 2
// DIAGNOSTIC: TS7034 1
// DIAGNOSTIC: TS7053 1

// `a["b"]` compiles to what `a.b` compiles to, and the errors stay those that TypeScript has for each spelling.
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
