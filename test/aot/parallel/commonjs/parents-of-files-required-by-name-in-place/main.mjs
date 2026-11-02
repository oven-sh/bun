// In place, what a CommonJS file requires by a computed name has the module of that file for its parent.
// Entry points: ./computed-first/child.cjs ./computed-first/other.cjs ./computed-first/middle.cjs ./computed-first/sub/inner.cjs ./computed-first/node_modules/dep/index.js ./computed-first/sub/node_modules/dep/index.js ./computed-only/child.cjs ./computed-only/other.cjs ./computed-only/middle.cjs ./computed-only/sub/inner.cjs ./computed-only/node_modules/dep/index.js ./computed-only/sub/node_modules/dep/index.js ./handed-on/child.cjs ./handed-on/other.cjs ./handed-on/middle.cjs ./handed-on/sub/inner.cjs ./handed-on/node_modules/dep/index.js ./handed-on/sub/node_modules/dep/index.js ./below/child.cjs ./below/other.cjs ./below/middle.cjs ./below/sub/inner.cjs ./below/node_modules/dep/index.js ./below/sub/node_modules/dep/index.js ./package-by-name/child.cjs ./package-by-name/other.cjs ./package-by-name/middle.cjs ./package-by-name/sub/inner.cjs ./package-by-name/node_modules/dep/index.js ./package-by-name/sub/node_modules/dep/index.js
// Flags: --compile-in-place
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# computed-first");
await import("./computed-first/computed-first.cjs");
await settled();
console.log("# computed-only");
await import("./computed-only/computed-only.cjs");
await settled();
console.log("# handed-on");
await import("./handed-on/handed-on.cjs");
await settled();
console.log("# below");
await import("./below/below.cjs");
await settled();
console.log("# package-by-name");
await import("./package-by-name/package-by-name.cjs");
await settled();
