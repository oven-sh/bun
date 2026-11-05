// Reference: bun build --compile
// @jsxImportSource ./tiny
const unused = <a />;
console.log("first this");
await import("./later");
