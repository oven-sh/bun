// Reference: bun build --compile
// What stands behind the word of a pragma is its argument, and the value of a source map comment is passed over whole: a pure mark in there marks nothing, and every call but the last runs.
const ran = [];
function note(what) { ran.push(what); }
/* @jsx @__PURE__ */ note("jsx");
/* @jsxFrag @__PURE__ */ note("jsxFrag");
/* @jsxImportSource #__PURE__ */ note("jsxImportSource");
/* @jsxRuntime @__PURE__ */ note("jsxRuntime");
/*# sourceMappingURL=a@__PURE__ */ note("sourceMappingURL");
/* @jsx h @__PURE__ */ note("behind the argument");
console.log(ran.join());
