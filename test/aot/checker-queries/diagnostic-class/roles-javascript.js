// A diagnostic carries its class and its effect on the build. A type error in the program's TypeScript stops the build. JavaScript reports its early errors and nothing else, even under `// @ts-check`. A declaration file reports nothing.
// @ts-check
again: { again: {} }
/** @type {number} */ const s = "x";
s();
