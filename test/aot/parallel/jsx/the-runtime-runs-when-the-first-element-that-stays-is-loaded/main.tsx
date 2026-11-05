// Reference: bun build --compile
// @jsxImportSource ./tiny
// @ts-expect-error
const unused = <a />;
console.log("first this");
await import("./later");
