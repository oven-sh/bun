// What `typeof` answers for `module`, `exports` and the `this` of the file is printed, so `bun run` keeps the names and the file is CommonJS: "object" is what the run answers too.
// The block in front does nothing: `bun run` removes it, and so does the build.
// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK-NOT: = TypeOf
// CHECK: [[text]] = String string="object"
// CHECK-NOT: = TypeOf
// CHECK: = Call {{*}}[[text]]{{*}}calleeName="console.log"

{
  typeof module;
}
console.log(typeof module, typeof exports, typeof this);
