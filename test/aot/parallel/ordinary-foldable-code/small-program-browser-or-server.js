const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
const isBun = typeof Bun !== "undefined";
const runtime = isBrowser ? "browser" : isBun ? "bun" : "node";
const storage = isBrowser ? window.localStorage : new Map();
console.log(runtime, storage instanceof Map);
