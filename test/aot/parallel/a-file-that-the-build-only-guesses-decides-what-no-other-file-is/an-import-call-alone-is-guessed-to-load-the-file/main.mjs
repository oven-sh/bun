const table = { silent: "./silent.cjs" };
globalThis.kept = table;
await import(table[["silent"][0]]);
