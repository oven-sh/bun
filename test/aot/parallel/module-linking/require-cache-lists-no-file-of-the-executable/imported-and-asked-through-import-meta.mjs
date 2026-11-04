const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
import "./real.cjs";
console.log("imported-and-asked-through-import-meta:", show(import.meta.require.cache[import.meta.require.resolve("./real.cjs")]));
