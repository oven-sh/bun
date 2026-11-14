// `bun run` prints "function" in the place of `typeof require` whatever the program has stored to the name, and so does the build.
// RUN: lower
// CHECK-NOT: = TypeOf
// CHECK: [[text]] = String string="function"
// CHECK: = Call {{*}}[[text]]{{*}}calleeName="console.log"
// CHECK-NOT: = TypeOf

require = 1;
console.log(typeof require);
