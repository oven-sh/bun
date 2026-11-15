// RUN: link
// CHECK-NOT: fields=[{key="a0"{{*}}{key="a1"
// CHECK: function {{*}}name="use" {{*}}parameters=[{type=undefined|null|L{{*}}|L{{*}}|L{{*}} flags=[IsExpected]}]
// CHECK: function {{*}}name="id" {{*}}parameters=[{type=undefined|null|L{{*}}|L{{*}}|L{{*}} flags=[IsExpected]}]

// What `id` hands back is what it is handed: one of three literals. TypeScript's widening of a union gives each of them the names of the other two, as properties that are
// undefined: a type that no object of the program has, of which `use` learned nothing, and n literals with a name of their own cost the build n * n properties.
let total = 0;

function use(v) {
  total += typeof v === "object" ? 1 : 2;
  return v;
}

function id(x) {
  return x;
}

use(id({ a0: 0 }));
use(id({ a1: 1 }));
use(id({ a2: 2, b: "t" }));
console.log(total);
