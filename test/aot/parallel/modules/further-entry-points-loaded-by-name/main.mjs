// What a program loads of its further entry points under computed names.
// Entry points: ./by-create-require/rt/literal.cjs ./by-create-require/rt/names.cjs ./by-create-require/rt/value.cjs ./by-create-require/rt/function.cjs ./by-create-require/rt/text.cjs ./by-create-require/rt/literal-in-js.js ./by-create-require/rt/names-in-js.js ./by-create-require/rt/es.mjs ./by-create-require/rt/es-in-js.js ./by-create-require/rt/counts.cjs ./by-require/rt/literal.cjs ./by-require/rt/names.cjs ./by-require/rt/value.cjs ./by-require/rt/function.cjs ./by-require/rt/text.cjs ./by-require/rt/literal-in-js.js ./by-require/rt/names-in-js.js ./by-require/rt/es.mjs ./by-require/rt/es-in-js.js ./by-require/rt/counts.cjs ./by-import/rt/literal.cjs ./by-import/rt/names.cjs ./by-import/rt/value.cjs ./by-import/rt/function.cjs ./by-import/rt/text.cjs ./by-import/rt/literal-in-js.js ./by-import/rt/names-in-js.js ./by-import/rt/es.mjs ./by-import/rt/es-in-js.js ./by-import/rt/counts.cjs ./by-import-then-require/rt/literal.cjs ./by-import-then-require/rt/names.cjs ./by-import-then-require/rt/value.cjs ./by-import-then-require/rt/function.cjs ./by-import-then-require/rt/text.cjs ./by-import-then-require/rt/literal-in-js.js ./by-import-then-require/rt/names-in-js.js ./by-import-then-require/rt/es.mjs ./by-import-then-require/rt/es-in-js.js ./by-import-then-require/rt/counts.cjs ./by-require-then-import/rt/literal.cjs ./by-require-then-import/rt/names.cjs ./by-require-then-import/rt/value.cjs ./by-require-then-import/rt/function.cjs ./by-require-then-import/rt/text.cjs ./by-require-then-import/rt/literal-in-js.js ./by-require-then-import/rt/names-in-js.js ./by-require-then-import/rt/es.mjs ./by-require-then-import/rt/es-in-js.js ./by-require-then-import/rt/counts.cjs ./by-a-written-name/rt/literal.cjs ./by-a-written-name/rt/names.cjs ./by-a-written-name/rt/value.cjs ./by-a-written-name/rt/function.cjs ./by-a-written-name/rt/text.cjs ./by-a-written-name/rt/literal-in-js.js ./by-a-written-name/rt/names-in-js.js ./by-a-written-name/rt/es.mjs ./by-a-written-name/rt/es-in-js.js ./by-a-written-name/rt/counts.cjs ./require-of-a-further-entry-point-does-not-call-a-then-that-i/rt/thenable.cjs
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# by-create-require");
await import("./by-create-require/by-create-require.mjs");
await settled();
console.log("# by-require");
await import("./by-require/by-require.cjs");
await settled();
console.log("# by-import");
await import("./by-import/by-import.mjs");
await settled();
console.log("# by-import-then-require");
await import("./by-import-then-require/by-import-then-require.mjs");
await settled();
console.log("# by-require-then-import");
await import("./by-require-then-import/by-require-then-import.mjs");
await settled();
console.log("# by-a-written-name");
await import("./by-a-written-name/by-a-written-name.mjs");
await settled();
console.log("# require-of-a-further-entry-point-does-not-call-a-then-that-i");
await import("./require-of-a-further-entry-point-does-not-call-a-then-that-i/main.cjs");
await settled();
