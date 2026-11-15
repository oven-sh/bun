// The transpiler gives each arm of the name a require of its own: `flag ? require("os") : require(unknown)`. It reads the written arm, and "bun:os" is a name for it alone: the loader knows none such.
// The arm is lowered as the transpiler prints it. The unknown arm stays what it is: the same text made at run time finds nothing.
// RUN: lower
// CHECK-NOT: string="bun:os"
// CHECK: = String string="os"
// CHECK-NOT: string="bun:os"
// CHECK: = RequireDynamic
// CHECK-NOT: string="bun:os"

// FILE: main.cjs
const flag = process.argv.length;
const unknown = process.env.MADE_UP_NAME;
console.log(typeof require(flag === 2 ? "bun:os" : unknown).cpus);
