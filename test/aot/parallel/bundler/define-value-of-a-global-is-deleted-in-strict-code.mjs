// `delete` of a member whose `--define` value is the name of a global removes that property of the global object, in strict code too. Where the file declares the name the build stops at such a `delete` (define-value-is-deleted-in-strict-code.mjs). Under plain Bun the file is a SyntaxError, and nothing of it runs. Plain Bun prints another output.
// Flags: --define process.env.ALIAS=target
globalThis.target = 1;
console.log(delete process.env.ALIAS, "target" in globalThis);
/* Output:
true false
*/
