// Two calls at once, an ES module and a CommonJS file: the module runs first. The loader ran a CommonJS file where it made the record of the file, steps ahead of where it runs an
// ES module, so b.cjs overtook a.mjs. It shows where files are read on another thread, as they are unless a variable says otherwise.
// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const [a, b] = await Promise.all([import("./a.mjs"), import("./b.cjs")]);
console.log(a.fromA + " " + b.fromB);
