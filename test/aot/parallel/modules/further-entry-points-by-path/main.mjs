// An executable finds its further entry points by the paths and package names they had when it was built.
// Entry points: ./package-names/app/node_modules/driver/lib/entry.js ./package-names/app/node_modules/driver/lib/extra.js ./package-names/app/node_modules/@scope/driver/main.cjs ./package-names/app/node_modules/both/common.cjs ./package-names/app/node_modules/both/es.mjs ./exported-names/app/node_modules/closed/lib/feature.js ./exported-names/app/node_modules/open/lib/inner.js ./exported-names/app/node_modules/open/lib/main.js ./exported-names/app/node_modules/patterns/features/one.js ./exported-names/app/node_modules/patterns/dist/tools/two.js ./exported-names/app/node_modules/patterns/es/three.mjs ./exported-names/app/node_modules/patterns/common/three.cjs ./exported-names/app/node_modules/two-fields/by-main.js ./exported-names/app/node_modules/two-fields/by-module.mjs ./files/app/plugins/a.cjs ./files/app/plugins/b.cjs ./files/app/plugins/es.mjs ./files/app/plugins/only-resolved.cjs ./files/app/lib/near/x.cjs ./files/app/lib/near/es.mjs ./files/app/worker.cjs
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# package-names");
await import("./package-names/app/main.cjs");
await settled();
console.log("# exported-names");
await import("./exported-names/app/main.cjs");
await settled();
console.log("# files");
await import("./files/app/main.cjs");
await settled();
