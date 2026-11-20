const { createRequire } = process.getBuiltinModule("node:module");
export const load = createRequire(import.meta.url);
export const askOwn = () => load("./part.cjs").said;
