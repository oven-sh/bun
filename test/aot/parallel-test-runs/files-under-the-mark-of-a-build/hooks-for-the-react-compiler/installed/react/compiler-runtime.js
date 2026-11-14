export const c = size => {
  globalThis.cachesAskedFor = (globalThis.cachesAskedFor ?? 0) + 1;
  return Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
};
