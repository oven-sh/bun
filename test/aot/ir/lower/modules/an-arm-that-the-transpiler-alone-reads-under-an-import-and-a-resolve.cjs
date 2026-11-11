// The transpiler gives each arm of the name an import() or a require.resolve() of its own, as it does for require(): `flag ? import("os") : import(unknown)`. "bun:os" is a name for it alone.
// Each written arm is lowered as the transpiler prints it. Under require.resolve() it reads no text that is joined: that arm stays as it is written.
// RUN: lower
// CHECK-NOT: string="bun:os"
// CHECK: = String string="os"
// CHECK-NOT: string="bun:os"
// CHECK: = String string="os"
// CHECK-NOT: string="bun:os"
// CHECK: = String string="bun:url"

// FILE: main.cjs
const flag = process.argv.length;
const unknown = process.env.MADE_UP_NAME;
import(flag === 2 ? "bun:os" : unknown).then(it => console.log(typeof it.cpus));
console.log(require.resolve(flag === 2 ? "bun:os" : unknown));
console.log(require.resolve(flag === 2 ? "bun:" + "url" : unknown));
