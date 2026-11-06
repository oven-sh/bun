// The loader lists the own keys of what a CommonJS module exports when an ES module imports it. Nothing in the program lists them, so the build has proven that their order is never seen, which
// holds: an importer binds names, and the names of a namespace object are sorted. A validating build must not take the loader's listing for a broken proof.
// Flags: --aot-validate
import { plain, viaGetter } from "./with-a-getter.cjs";
import { late } from "./filled-by-another.cjs";
console.log(plain, viaGetter, late);
const names = await import("./with-a-getter.cjs");
console.log(names.plain, names.viaGetter, typeof names.default);
