// Create require is assigned on what get builtin module answers.
// DECLARED: docs/compiler/compatibility.mdx, "Built-in objects are read-only". The build says of an assignment that it always throws only as far as one body shows it, and this one stands behind a call. The lock refuses the store when it runs. `bun <file>` and `bun build --compile` store.
process.getBuiltinModule("node:module").createRequire = () => name => console.log("mine", name); process.getBuiltinModule("node:module").createRequire(import.meta.url)("./next.mjs");
/* Output:
exit code 1
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
