// A comment `/* __PURE__ */` without the `@` or `#` is no annotation: the call runs.
const a = /* __PURE__ */ console.log("ran");
console.log("end");
