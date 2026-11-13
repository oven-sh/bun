// `import defer` puts off when a file runs, not when it is linked. The two CommonJS files that the deferred file imports run when the graph is loaded, in the order in which the deferred file names them.
// `bun <file>` starts them in the order in which the threads of its transpiler finish their texts: a slow build of Bun prints them the other way round in six runs of twelve. So what the executable prints stands here.
await import("./reader.mjs").catch(error => console.log("rejected:", error.message));

/* Output:
stores.cjs runs
then-stores.cjs runs
reader.mjs runs object
1 2
*/
