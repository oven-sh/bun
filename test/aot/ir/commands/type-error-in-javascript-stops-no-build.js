// A type error in a JavaScript file is not reported, though each file and their project ask to be checked: it stops no build, and a test run warns of nothing.
// type-error-stops-the-build.ts has the same store in TypeScript.
// RUN: link
// RUN(TESTS): link
// OPTIONS(TESTS): runs-tests
// STATISTIC: SourceFilesChecked = 0
// STATISTIC: SourceFilesInferred = 4
// CHECK: = String string="one"
// TESTS: = String string="one"

// FILE: main.js
// @ts-check
import "./module.mjs";
import "./common.cjs";
import "./element.jsx";
/** @type {number} */
export const count = "one";

// FILE: module.mjs
// @ts-check
/** @type {number} */
export const count = "one";

// FILE: common.cjs
// @ts-check
/** @type {number} */
const count = "one";
module.exports = count;

// FILE: element.jsx
// @ts-check
/** @type {number} */
export const count = "one";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "types": [], "jsx": "react-jsx", "allowJs": true, "checkJs": true, "strict": true, "noEmit": true } }
