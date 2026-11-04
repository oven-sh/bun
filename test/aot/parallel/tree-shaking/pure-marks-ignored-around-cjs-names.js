// With --ignore-dce-annotations a call that is marked pure stays, also where its arguments name `module`, `exports` or the `this` of the file.
// Flags: --ignore-dce-annotations
// Reference: bun build --compile
function loud(name, value) {
  console.log("called", name, value);
}
/* @__PURE__ */ loud("typeof module", typeof module);
/* @__PURE__ */ loud("typeof exports", typeof exports);
/* @__PURE__ */ loud("typeof this", typeof this);
/* @__PURE__ */ loud("module", module.exports === exports);
/* @__PURE__ */ loud("this", this === exports);
console.log("end");
