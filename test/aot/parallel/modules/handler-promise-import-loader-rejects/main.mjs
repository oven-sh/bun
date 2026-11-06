// Each file that is imported here imports nothing and throws nothing, so only the loader rejects these promises. The handlers stand on the promise of the import itself.
const describe = error => [typeof error, error?.constructor?.name, error instanceof TypeError, error?.name, typeof error?.stack, String(error).slice(0, 70)].join(" | ");

await import("./leaf.mjs", 5).then(
  loaded => console.log("then, a number: loaded", loaded.v),
  error => console.log("then, a number:", error.message),
);
await import("./leaf.mjs", "options").catch(error => console.log("catch, a string:", error.message));
await import("./leaf.mjs", { with: 5 }).catch(error => console.log("catch, attributes that are no object:", describe(error)));
await import("./leaf.mjs", { with: { type: 5 } }).then(undefined, error => console.log("then, a type that is no string:", describe(error)));
await import("./leaf.cjs", 5).catch(error => console.log("catch, a CommonJS file:", describe(error)));
await import("./leaf.json", 5).catch(error => console.log("catch, a JSON file:", describe(error)));
await import("node:path", 5).catch(error => console.log("catch, a built-in module:", describe(error)));
await import("./leaf.mjs", {
  get with() {
    throw new RangeError("thrown by a getter");
  },
}).catch(error => console.log("catch, a getter that throws:", describe(error)));
await import("./leaf.mjs", 5)
  .catch(error => {
    throw error;
  })
  .catch(error => console.log("thrown again:", error instanceof Error, error.message));
await import("./leaf.mjs", 5).finally(() => console.log("finally")).catch(error => console.log("behind finally:", error?.code, error.message));
try {
  await import("./leaf.mjs", 5);
} catch (error) {
  console.log("await:", describe(error));
}
console.log("loaded:", (await import("./leaf.mjs")).v);
