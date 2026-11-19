// `bun:bake`, for the `bake.config.ts` of a `bun bake` project. `internal/bake.ts` reads that file.

/** Returns `config` as it is. It exists for types. */
function defineConfig<T>(config: T): T {
  return config;
}

export default { defineConfig };
