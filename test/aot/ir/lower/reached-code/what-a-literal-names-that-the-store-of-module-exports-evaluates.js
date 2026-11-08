// RUN: link
// CHECK-LABEL: function {{*}}name="sum"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return

// RUN(CLASS): link
// CLASS-LABEL: function {{*}}name="add"
// CLASS-NOT: LeftOutOfExecutable
// CLASS: Return

// `const held = { sum }; module.exports = held;`: the module graph erases the declaration, and the store evaluates its literal. So what the literal names runs with the file,
// as in `module.exports = { sum }`.

// FILE: main.mjs
import { sum } from "./sum.cjs";
import { Adder } from "./adder.cjs";
console.log(sum(1, 2), new Adder().add(1, 2));

// FILE: sum.cjs
function sum(a, b) {
  for (let i = 0; i < 2; i++) a += 0;
  return a + b;
}
const held = { sum };
module.exports = held;

// FILE: adder.cjs
class Adder {
  add(a, b) {
    for (let i = 0; i < 2; i++) a += 0;
    return a + b;
  }
}
const held = { Adder };
module.exports = held;
