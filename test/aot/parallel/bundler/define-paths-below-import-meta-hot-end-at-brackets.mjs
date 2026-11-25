// Below a member of `import.meta.hot`, a link in brackets matches no define and no dropped call.
// Flags: --define=import.meta.hot.data=inner.data --define=import.meta.hot.data.x=other.x --drop=import.meta.hot.data.log
// Reference: bun build --compile
const inner = { data: { x: "inner", log: () => "logged" } };
const other = { x: "other" };
console.log(import.meta.hot.data["x"], import.meta.hot.data.x, import.meta.hot.data["log"](), import.meta.hot.data.log());
