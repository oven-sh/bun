// A DECLARED LIMIT. docs/compiler/compatibility.mdx: "The query has to be a constant: `import("./a.ts?v=" + version)` names a copy that the executable doesn't hold, so the import throws, also when the file is an entry point."
// Under `bun run` the file is loaded under the query.
// Entry points: ./conf.mjs
const version = process.env.MADE_UP_VERSION || "1";
try {
  console.log((await import("./conf.mjs?v=" + version)).name);
} catch (error) {
  console.log(error.code);
}
/* Output:
ERR_MODULE_NOT_FOUND
*/
