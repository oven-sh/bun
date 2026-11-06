// @bun
// What `bun build main.mjs other.mjs --target=bun --splitting --format=esm` makes of four plain files: owner.mjs, which both entry points import and which requires inner.cjs, becomes a chunk of its own.
// From the four files the program is right; it has to be right from the bundle too. The same with --minify: minified.js. All four files are formatted.
import { x } from "./main-zz8gnpwd.js";
import "./minified.js";

// main.mjs
console.log("main", x);
