// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 105

// FILE: main.mjs
// Each page gets at a package that says "sideEffects": false in another way, and every file of the packages prints when it is evaluated. The pages are loaded by import(). `bun build --compile` makes a function of a file that a call loads and of all that such a file imports: an import of which a name is used calls the function of the file that it names, and so does every `export *` of a file that runs, whatever the package says.
{ const { page } = await import("./pages/a-name-is-used.mjs"); console.log("a-name-is-used:", page()); }
{ const { page } = await import("./pages/no-name-is-used.mjs"); console.log("no-name-is-used:", page()); }
{ const { page } = await import("./pages/a-name-is-used-where-nothing-comes.mjs"); console.log("a-name-is-used-where-nothing-comes:", page()); }
{ const { page } = await import("./pages/no-name-is-imported.mjs"); console.log("no-name-is-imported:", page()); }
{ const { page } = await import("./pages/a-member-of-the-object.mjs"); console.log("a-member-of-the-object:", page()); }
{ const { page } = await import("./pages/the-object-itself.mjs"); console.log("the-object-itself:", page()); }
{ const { page } = await import("./pages/the-object-unused.mjs"); console.log("the-object-unused:", page()); }
{ const { page } = await import("./pages/handed-on-by-name.mjs"); console.log("handed-on-by-name:", page()); }
{ const { page } = await import("./pages/handed-on-by-star.mjs"); console.log("handed-on-by-star:", page()); }
{ const { page } = await import("./pages/handed-on-as-an-object.mjs"); console.log("handed-on-as-an-object:", page()); }
{ const { page } = await import("./pages/only-its-type-is-asked.mjs"); console.log("only-its-type-is-asked:", page()); }
{ const { page } = await import("./pages/by-names.mjs"); console.log("by-names:", page()); }
{ const { page } = await import("./pages/beside-a-star-with-a-name.mjs"); console.log("beside-a-star-with-a-name:", page()); }
{ const { page } = await import("./pages/a-star-with-a-name.mjs"); console.log("a-star-with-a-name:", page()); }
{ const { page } = await import("./pages/three-stars-in-a-row.mjs"); console.log("three-stars-in-a-row:", page()); }
{ const { page } = await import("./pages/a-star-a-name-a-star.mjs"); console.log("a-star-a-name-a-star:", page()); }
{ const { page } = await import("./pages/the-file-imports-for-its-own-functions.mjs"); console.log("the-file-imports-for-its-own-functions:", page()); }
{ const { page } = await import("./pages/a-function-of-the-file-itself.mjs"); console.log("a-function-of-the-file-itself:", page()); }
{ const { page } = await import("./pages/the-default-by-name.mjs"); console.log("the-default-by-name:", page()); }
{ const { page } = await import("./pages/stars-of-other-packages.mjs"); console.log("stars-of-other-packages:", page()); }
{ const { page } = await import("./pages/stars-in-a-ring.mjs"); console.log("stars-in-a-ring:", page()); }
{ const { page } = await import("./pages/the-file-makes-a-global.mjs"); console.log("the-file-makes-a-global:", page()); }

// FILE: node_modules/a-function-of-the-file-itself/bare.js
console.log("a-function-of-the-file-itself/bare.js is evaluated");

// FILE: node_modules/a-function-of-the-file-itself/beside.js
console.log("a-function-of-the-file-itself/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/a-function-of-the-file-itself/definer.js
console.log("a-function-of-the-file-itself/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/a-function-of-the-file-itself/helper.js
console.log("a-function-of-the-file-itself/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/a-function-of-the-file-itself/index.js
console.log("a-function-of-the-file-itself/index.js is evaluated");
import { helper } from "./helper.js";
import { beside } from "./beside.js";
export function own() { return helper(); }
export function other() { return beside(); }
export * from "./definer.js";

// FILE: node_modules/a-function-of-the-file-itself/package.json
{"name": "a-function-of-the-file-itself", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/a-loud-package/index.js
console.log("a-loud-package/index.js is evaluated");
export function loud() { return "loud"; }

// FILE: node_modules/a-loud-package/package.json
{"name": "a-loud-package", "version": "1.0.0", "type": "module", "main": "index.js"}

// FILE: node_modules/a-member-of-the-object/bare.js
console.log("a-member-of-the-object/bare.js is evaluated");

// FILE: node_modules/a-member-of-the-object/beside.js
console.log("a-member-of-the-object/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/a-member-of-the-object/definer.js
console.log("a-member-of-the-object/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/a-member-of-the-object/helper.js
console.log("a-member-of-the-object/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/a-member-of-the-object/index.js
console.log("a-member-of-the-object/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/a-member-of-the-object/package.json
{"name": "a-member-of-the-object", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/a-name-is-used-where-nothing-comes/bare.js
console.log("a-name-is-used-where-nothing-comes/bare.js is evaluated");

// FILE: node_modules/a-name-is-used-where-nothing-comes/beside.js
console.log("a-name-is-used-where-nothing-comes/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/a-name-is-used-where-nothing-comes/definer.js
console.log("a-name-is-used-where-nothing-comes/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/a-name-is-used-where-nothing-comes/helper.js
console.log("a-name-is-used-where-nothing-comes/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/a-name-is-used-where-nothing-comes/index.js
console.log("a-name-is-used-where-nothing-comes/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/a-name-is-used-where-nothing-comes/package.json
{"name": "a-name-is-used-where-nothing-comes", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/a-name-is-used/bare.js
console.log("a-name-is-used/bare.js is evaluated");

// FILE: node_modules/a-name-is-used/beside.js
console.log("a-name-is-used/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/a-name-is-used/definer.js
console.log("a-name-is-used/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/a-name-is-used/helper.js
console.log("a-name-is-used/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/a-name-is-used/index.js
console.log("a-name-is-used/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/a-name-is-used/package.json
{"name": "a-name-is-used", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/a-star-a-name-a-star/bare.js
console.log("a-star-a-name-a-star/bare.js is evaluated");

// FILE: node_modules/a-star-a-name-a-star/beside.js
console.log("a-star-a-name-a-star/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/a-star-a-name-a-star/definer.js
console.log("a-star-a-name-a-star/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/a-star-a-name-a-star/helper.js
console.log("a-star-a-name-a-star/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/a-star-a-name-a-star/index.js
console.log("a-star-a-name-a-star/index.js is evaluated");
export * from "./second.js";

// FILE: node_modules/a-star-a-name-a-star/package.json
{"name": "a-star-a-name-a-star", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/a-star-a-name-a-star/second.js
console.log("a-star-a-name-a-star/second.js is evaluated");
export { a } from "./third.js";
export { beside } from "./beside.js";

// FILE: node_modules/a-star-a-name-a-star/third.js
console.log("a-star-a-name-a-star/third.js is evaluated");
export * from "./definer.js";

// FILE: node_modules/a-star-with-a-name/bare.js
console.log("a-star-with-a-name/bare.js is evaluated");

// FILE: node_modules/a-star-with-a-name/beside.js
console.log("a-star-with-a-name/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/a-star-with-a-name/definer.js
console.log("a-star-with-a-name/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/a-star-with-a-name/helper.js
console.log("a-star-with-a-name/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/a-star-with-a-name/index.js
console.log("a-star-with-a-name/index.js is evaluated");
export * as inner from "./beside.js";
export * from "./definer.js";

// FILE: node_modules/a-star-with-a-name/package.json
{"name": "a-star-with-a-name", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/another-pure-package/index.js
console.log("another-pure-package/index.js is evaluated");
export function second() { return "second"; }

// FILE: node_modules/another-pure-package/package.json
{"name": "another-pure-package", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/beside-a-star-with-a-name/bare.js
console.log("beside-a-star-with-a-name/bare.js is evaluated");

// FILE: node_modules/beside-a-star-with-a-name/beside.js
console.log("beside-a-star-with-a-name/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/beside-a-star-with-a-name/definer.js
console.log("beside-a-star-with-a-name/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/beside-a-star-with-a-name/helper.js
console.log("beside-a-star-with-a-name/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/beside-a-star-with-a-name/index.js
console.log("beside-a-star-with-a-name/index.js is evaluated");
export * as inner from "./beside.js";
export * from "./definer.js";

// FILE: node_modules/beside-a-star-with-a-name/package.json
{"name": "beside-a-star-with-a-name", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/by-names/bare.js
console.log("by-names/bare.js is evaluated");

// FILE: node_modules/by-names/beside.js
console.log("by-names/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/by-names/definer.js
console.log("by-names/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/by-names/helper.js
console.log("by-names/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/by-names/index.js
console.log("by-names/index.js is evaluated");
export { a } from "./definer.js";
export { beside } from "./beside.js";
import "./bare.js";

// FILE: node_modules/by-names/package.json
{"name": "by-names", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/handed-on-as-an-object/bare.js
console.log("handed-on-as-an-object/bare.js is evaluated");

// FILE: node_modules/handed-on-as-an-object/beside.js
console.log("handed-on-as-an-object/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/handed-on-as-an-object/definer.js
console.log("handed-on-as-an-object/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/handed-on-as-an-object/helper.js
console.log("handed-on-as-an-object/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/handed-on-as-an-object/index.js
console.log("handed-on-as-an-object/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/handed-on-as-an-object/package.json
{"name": "handed-on-as-an-object", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/handed-on-by-name/bare.js
console.log("handed-on-by-name/bare.js is evaluated");

// FILE: node_modules/handed-on-by-name/beside.js
console.log("handed-on-by-name/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/handed-on-by-name/definer.js
console.log("handed-on-by-name/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/handed-on-by-name/helper.js
console.log("handed-on-by-name/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/handed-on-by-name/index.js
console.log("handed-on-by-name/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/handed-on-by-name/package.json
{"name": "handed-on-by-name", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/handed-on-by-star/bare.js
console.log("handed-on-by-star/bare.js is evaluated");

// FILE: node_modules/handed-on-by-star/beside.js
console.log("handed-on-by-star/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/handed-on-by-star/definer.js
console.log("handed-on-by-star/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/handed-on-by-star/helper.js
console.log("handed-on-by-star/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/handed-on-by-star/index.js
console.log("handed-on-by-star/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/handed-on-by-star/package.json
{"name": "handed-on-by-star", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/no-name-is-imported/bare.js
console.log("no-name-is-imported/bare.js is evaluated");

// FILE: node_modules/no-name-is-imported/beside.js
console.log("no-name-is-imported/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/no-name-is-imported/definer.js
console.log("no-name-is-imported/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/no-name-is-imported/helper.js
console.log("no-name-is-imported/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/no-name-is-imported/index.js
console.log("no-name-is-imported/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/no-name-is-imported/package.json
{"name": "no-name-is-imported", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/no-name-is-used/bare.js
console.log("no-name-is-used/bare.js is evaluated");

// FILE: node_modules/no-name-is-used/beside.js
console.log("no-name-is-used/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/no-name-is-used/definer.js
console.log("no-name-is-used/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/no-name-is-used/helper.js
console.log("no-name-is-used/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/no-name-is-used/index.js
console.log("no-name-is-used/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/no-name-is-used/package.json
{"name": "no-name-is-used", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/only-its-type-is-asked/bare.js
console.log("only-its-type-is-asked/bare.js is evaluated");

// FILE: node_modules/only-its-type-is-asked/beside.js
console.log("only-its-type-is-asked/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/only-its-type-is-asked/definer.js
console.log("only-its-type-is-asked/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/only-its-type-is-asked/helper.js
console.log("only-its-type-is-asked/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/only-its-type-is-asked/index.js
console.log("only-its-type-is-asked/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/only-its-type-is-asked/package.json
{"name": "only-its-type-is-asked", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/stars-in-a-ring/bare.js
console.log("stars-in-a-ring/bare.js is evaluated");

// FILE: node_modules/stars-in-a-ring/beside.js
console.log("stars-in-a-ring/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/stars-in-a-ring/definer.js
console.log("stars-in-a-ring/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/stars-in-a-ring/helper.js
console.log("stars-in-a-ring/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/stars-in-a-ring/index.js
console.log("stars-in-a-ring/index.js is evaluated");
export * from "./round.js";
export * from "./definer.js";

// FILE: node_modules/stars-in-a-ring/package.json
{"name": "stars-in-a-ring", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/stars-in-a-ring/round.js
console.log("stars-in-a-ring/round.js is evaluated");
export * from "./index.js";
export function round() { return "round"; }

// FILE: node_modules/stars-of-other-packages/bare.js
console.log("stars-of-other-packages/bare.js is evaluated");

// FILE: node_modules/stars-of-other-packages/beside.js
console.log("stars-of-other-packages/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/stars-of-other-packages/definer.js
console.log("stars-of-other-packages/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/stars-of-other-packages/helper.js
console.log("stars-of-other-packages/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/stars-of-other-packages/index.js
console.log("stars-of-other-packages/index.js is evaluated");
export * from "another-pure-package";
export * from "a-loud-package";
export * from "./definer.js";

// FILE: node_modules/stars-of-other-packages/package.json
{"name": "stars-of-other-packages", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/the-default-by-name/bare.js
console.log("the-default-by-name/bare.js is evaluated");

// FILE: node_modules/the-default-by-name/beside.js
console.log("the-default-by-name/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/the-default-by-name/definer.js
console.log("the-default-by-name/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/the-default-by-name/helper.js
console.log("the-default-by-name/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/the-default-by-name/index.js
console.log("the-default-by-name/index.js is evaluated");
export { default } from "./definer.js";
export * from "./beside.js";

// FILE: node_modules/the-default-by-name/package.json
{"name": "the-default-by-name", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/the-file-imports-for-its-own-functions/bare.js
console.log("the-file-imports-for-its-own-functions/bare.js is evaluated");

// FILE: node_modules/the-file-imports-for-its-own-functions/beside.js
console.log("the-file-imports-for-its-own-functions/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/the-file-imports-for-its-own-functions/definer.js
console.log("the-file-imports-for-its-own-functions/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/the-file-imports-for-its-own-functions/helper.js
console.log("the-file-imports-for-its-own-functions/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/the-file-imports-for-its-own-functions/index.js
console.log("the-file-imports-for-its-own-functions/index.js is evaluated");
import { helper } from "./helper.js";
import { beside } from "./beside.js";
export function own() { return helper(); }
export function other() { return beside(); }
export * from "./definer.js";

// FILE: node_modules/the-file-imports-for-its-own-functions/package.json
{"name": "the-file-imports-for-its-own-functions", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/the-file-makes-a-global/index.js
console.log("the-file-makes-a-global/index.js is evaluated");
globalThis.flagOfThePackage = "set";
export * from "./reader.js";

// FILE: node_modules/the-file-makes-a-global/package.json
{"name": "the-file-makes-a-global", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/the-file-makes-a-global/reader.js
console.log("the-file-makes-a-global/reader.js is evaluated");
export function a() { return typeof flagOfThePackage; }

// FILE: node_modules/the-object-itself/bare.js
console.log("the-object-itself/bare.js is evaluated");

// FILE: node_modules/the-object-itself/beside.js
console.log("the-object-itself/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/the-object-itself/definer.js
console.log("the-object-itself/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/the-object-itself/helper.js
console.log("the-object-itself/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/the-object-itself/index.js
console.log("the-object-itself/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/the-object-itself/package.json
{"name": "the-object-itself", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/the-object-unused/bare.js
console.log("the-object-unused/bare.js is evaluated");

// FILE: node_modules/the-object-unused/beside.js
console.log("the-object-unused/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/the-object-unused/definer.js
console.log("the-object-unused/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/the-object-unused/helper.js
console.log("the-object-unused/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/the-object-unused/index.js
console.log("the-object-unused/index.js is evaluated");
export * from "./definer.js";
export * from "./beside.js";
import "./bare.js";

// FILE: node_modules/the-object-unused/package.json
{"name": "the-object-unused", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/three-stars-in-a-row/bare.js
console.log("three-stars-in-a-row/bare.js is evaluated");

// FILE: node_modules/three-stars-in-a-row/beside.js
console.log("three-stars-in-a-row/beside.js is evaluated");
export function beside() { return "beside"; }

// FILE: node_modules/three-stars-in-a-row/definer.js
console.log("three-stars-in-a-row/definer.js is evaluated");
export function a() { return "a"; }
export function b() { return "b"; }
export default function c() { return "c"; }

// FILE: node_modules/three-stars-in-a-row/helper.js
console.log("three-stars-in-a-row/helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/three-stars-in-a-row/index.js
console.log("three-stars-in-a-row/index.js is evaluated");
export * from "./second.js";

// FILE: node_modules/three-stars-in-a-row/package.json
{"name": "three-stars-in-a-row", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/three-stars-in-a-row/second.js
console.log("three-stars-in-a-row/second.js is evaluated");
export * from "./third.js";
export * from "./beside.js";

// FILE: node_modules/three-stars-in-a-row/third.js
console.log("three-stars-in-a-row/third.js is evaluated");
export * from "./definer.js";

// FILE: pages/a-function-of-the-file-itself.mjs
import { own } from "a-function-of-the-file-itself";
export const page = () => own();

// FILE: pages/a-member-of-the-object.mjs
import * as all from "a-member-of-the-object";
export const page = () => all.a();

// FILE: pages/a-name-is-used-where-nothing-comes.mjs
import { a } from "a-name-is-used-where-nothing-comes";
function never() { return a(); }
export const page = () => "nothing";

// FILE: pages/a-name-is-used.mjs
import { a } from "a-name-is-used";
export const page = () => a();

// FILE: pages/a-star-a-name-a-star.mjs
import { a } from "a-star-a-name-a-star";
export const page = () => a();

// FILE: pages/a-star-with-a-name.mjs
import { inner } from "a-star-with-a-name";
export const page = () => inner.beside();

// FILE: pages/beside-a-star-with-a-name.mjs
import { a } from "beside-a-star-with-a-name";
export const page = () => a();

// FILE: pages/by-names.mjs
import { a } from "by-names";
export const page = () => a();

// FILE: pages/handed-on-as-an-object.mjs
export * as all from "handed-on-as-an-object";
export const page = () => "nothing";

// FILE: pages/handed-on-by-name.mjs
export { a } from "handed-on-by-name";
export const page = () => "nothing";

// FILE: pages/handed-on-by-star.mjs
export * from "handed-on-by-star";
export const page = () => "nothing";

// FILE: pages/no-name-is-imported.mjs
import "no-name-is-imported";
export const page = () => "nothing";

// FILE: pages/no-name-is-used.mjs
import { a } from "no-name-is-used";
export const page = () => "nothing";

// FILE: pages/only-its-type-is-asked.mjs
import { a } from "only-its-type-is-asked";
export const page = () => typeof a;

// FILE: pages/stars-in-a-ring.mjs
import { a } from "stars-in-a-ring";
export const page = () => a();

// FILE: pages/stars-of-other-packages.mjs
import { a } from "stars-of-other-packages";
export const page = () => a();

// FILE: pages/the-default-by-name.mjs
import c from "the-default-by-name";
export const page = () => c();

// FILE: pages/the-file-imports-for-its-own-functions.mjs
import { a } from "the-file-imports-for-its-own-functions";
export const page = () => a();

// FILE: pages/the-file-makes-a-global.mjs
import { a } from "the-file-makes-a-global";
export const page = () => a();

// FILE: pages/the-object-itself.mjs
import * as all from "the-object-itself";
export const page = () => Object.keys(all).join();

// FILE: pages/the-object-unused.mjs
import * as all from "the-object-unused";
export const page = () => "nothing";

// FILE: pages/three-stars-in-a-row.mjs
import { a } from "three-stars-in-a-row";
export const page = () => a();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
