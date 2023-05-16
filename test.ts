function getError(msg) {
  return new Error(msg);
}
const err = new Error("A");
const err2 = getError("B");
// With the line below commented out, the stacks will be normal
console.log({ x: err.stack, y: err2.stack });
console.log({ x: err.stack, y: err2.stack });
console.error(err); // expect "at /.../stuff.ts:4:12", get "at /.../stuff.ts:5:22"
console.error(err2);
// expect:
// "at getError (/.../stuff.ts:2:11)
//  at /.../stuff.ts:5:13"
// get:
// "at /.../stuff.ts:2:24"
