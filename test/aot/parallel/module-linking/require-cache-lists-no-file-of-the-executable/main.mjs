// In an executable `require.cache` lists no file of the executable: `bun build --compile` wraps each file in a function of its own and enters none in the table, and an executable made with --aot says what that one says.
// `bun <file>` lists them, and so does a test run. A store into the table and a delete change nothing of what `require` of such a file answers.
// Reference: bun build --compile
await import("./by-what-resolve-answers.cjs");
await import("./by-a-constant.cjs");
await import("./by-a-computed-name.cjs");
await import("./by-the-folder-and-a-name.cjs");
await import("./by-a-joined-path.cjs");
await import("./by-a-pattern.cjs");
await import("./keys.cjs");
await import("./values.cjs");
await import("./in.cjs");
await import("./for-in.cjs");
await import("./own-file.cjs");
await import("./es-module.cjs");
await import("./json.cjs");
await import("./built-in-module.cjs");
await import("./cache-of-the-module-module.cjs");
await import("./ahead-of-the-require.cjs");
await import("./exports-compared.cjs");
await import("./store.cjs");
await import("./delete-and-require-again.cjs");
await import("./asked-by-another-file.cjs");
await import("./imported-and-asked-through-create-require.mjs");
await import("./imported-and-asked-through-import-meta.mjs");
