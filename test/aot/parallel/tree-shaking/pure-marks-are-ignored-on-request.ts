// With --ignore-dce-annotations a call that is marked pure is a call like any other: it stays, though nothing reads its result.
// Flags: --ignore-dce-annotations
// Reference: bun build --compile
function loud(name: string): number {
  console.log("called", name);
  return name.length;
}
class Noisy {
  constructor(name: string) {
    console.log("made", name);
  }
}
const unread = /* @__PURE__ */ loud("in a constant");
let alsoUnread = /* #__PURE__ */ new Noisy("in a variable");
/* @__PURE__ */ loud("in a statement");
const nested = [/* @__PURE__ */ loud("in an array"), { inner: /* @__PURE__ */ loud("in an object") }];
export {};
console.log("end");
