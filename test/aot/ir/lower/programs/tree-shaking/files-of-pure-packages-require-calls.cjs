// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 44

// FILE: main.cjs
// As files-of-pure-packages-behind-import-calls, with pages that are loaded by require().
{ const { page } = require("./pages/a-name-is-used.mjs"); console.log("a-name-is-used:", page()); }
{ const { page } = require("./pages/no-name-is-used.mjs"); console.log("no-name-is-used:", page()); }
{ const { page } = require("./pages/a-member-of-the-object.mjs"); console.log("a-member-of-the-object:", page()); }
{ const { page } = require("./pages/handed-on-by-star.mjs"); console.log("handed-on-by-star:", page()); }
{ const { page } = require("./pages/handed-on-as-an-object.mjs"); console.log("handed-on-as-an-object:", page()); }
{ const { page } = require("./pages/a-star-with-a-name.mjs"); console.log("a-star-with-a-name:", page()); }
{ const { page } = require("./pages/a-star-a-name-a-star.mjs"); console.log("a-star-a-name-a-star:", page()); }
{ const { page } = require("./pages/stars-of-other-packages.mjs"); console.log("stars-of-other-packages:", page()); }
{ const { page } = require("./pages/the-file-makes-a-global.mjs"); console.log("the-file-makes-a-global:", page()); }

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

// FILE: node_modules/the-file-makes-a-global/index.js
console.log("the-file-makes-a-global/index.js is evaluated");
globalThis.flagOfThePackage = "set";
export * from "./reader.js";

// FILE: node_modules/the-file-makes-a-global/package.json
{"name": "the-file-makes-a-global", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false}

// FILE: node_modules/the-file-makes-a-global/reader.js
console.log("the-file-makes-a-global/reader.js is evaluated");
export function a() { return typeof flagOfThePackage; }

// FILE: pages/a-member-of-the-object.mjs
import * as all from "a-member-of-the-object";
export const page = () => all.a();

// FILE: pages/a-name-is-used.mjs
import { a } from "a-name-is-used";
export const page = () => a();

// FILE: pages/a-star-a-name-a-star.mjs
import { a } from "a-star-a-name-a-star";
export const page = () => a();

// FILE: pages/a-star-with-a-name.mjs
import { inner } from "a-star-with-a-name";
export const page = () => inner.beside();

// FILE: pages/handed-on-as-an-object.mjs
export * as all from "handed-on-as-an-object";
export const page = () => "nothing";

// FILE: pages/handed-on-by-star.mjs
export * from "handed-on-by-star";
export const page = () => "nothing";

// FILE: pages/no-name-is-used.mjs
import { a } from "no-name-is-used";
export const page = () => "nothing";

// FILE: pages/stars-of-other-packages.mjs
import { a } from "stars-of-other-packages";
export const page = () => a();

// FILE: pages/the-file-makes-a-global.mjs
import { a } from "the-file-makes-a-global";
export const page = () => a();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
